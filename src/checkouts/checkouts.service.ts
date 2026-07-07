import { Injectable, NotFoundException } from '@nestjs/common';
import { CheckoutStatus, Prisma, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LocationSelectionService } from './location-selection.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

/**
 * CheckoutsService
 *
 * Orchestrates checkout creation:
 *   1. Validates the product exists.
 *   2. Delegates warehouse selection to LocationSelectionService (read-only).
 *   3. Executes a single Prisma transaction that atomically:
 *      a) Increments inventory.reserved using a conditional WHERE guard
 *         (stock >= reserved + quantity) to prevent overselling.
 *      b) Creates a Reservation record.
 *      c) Creates the Checkout record linking product, location, and reservation.
 *
 * Payment transitions (success / failure / abandoned) will be added in
 * Milestone 7 by adding methods to this service that call the Reservation
 * release/complete helpers — no structural changes to this service needed.
 */
@Injectable()
export class CheckoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locationSelection: LocationSelectionService,
  ) {}

  async create(dto: CreateCheckoutDto) {
    const { productId, quantity, deliveryPincode, deliveryCity, deliveryState } = dto;

    // 1. Validate the product exists (outside transaction — read-only check).
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    // 2. Select the best warehouse (read-only; throws 422 if none qualifies).
    const selectedInventory = await this.locationSelection.selectLocation(
      productId,
      quantity,
      deliveryPincode,
      deliveryCity,
      deliveryState,
    );

    const { id: inventoryId, locationId } = selectedInventory;

    // 3. Atomically reserve stock and create the checkout.
    //    The conditional updateMany guard prevents overselling under concurrency:
    //    another concurrent request that consumed the same stock first will
    //    cause count === 0, which triggers a re-throw from within the tx.
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 3a. Atomic stock guard: only increments reserved when sufficient stock exists.
      const updated = await tx.inventory.updateMany({
        where: {
          id: inventoryId,
          // available = stock - reserved >= quantity
          stock: { gte: selectedInventory.reserved + quantity },
        },
        data: { reserved: { increment: quantity } },
      });

      if (updated.count === 0) {
        // Another concurrent request consumed the stock after our read.
        // Re-run selection is intentionally not done here — the client should retry.
        throw new Error(
          `Stock was consumed concurrently for inventory ${inventoryId}. Please retry.`,
        );
      }

      // 3b. Create the Reservation record.
      const reservation = await tx.reservation.create({
        data: {
          inventoryId,
          quantity,
          status: ReservationStatus.ACTIVE,
        },
      });

      // 3c. Create the Checkout record.
      return tx.checkout.create({
        data: {
          productId,
          locationId,
          reservationId: reservation.id,
          quantity,
          status: CheckoutStatus.PENDING_PAYMENT,
          deliveryPincode,
          deliveryCity,
          deliveryState,
        },
        include: {
          product: true,
          location: true,
          reservation: true,
        },
      });
    });
  }

  async findOne(id: string) {
    const checkout = await this.prisma.checkout.findUnique({
      where: { id },
      include: {
        product: true,
        location: true,
        reservation: true,
      },
    });

    if (!checkout) {
      throw new NotFoundException(`Checkout with ID ${id} not found`);
    }

    return checkout;
  }
}
