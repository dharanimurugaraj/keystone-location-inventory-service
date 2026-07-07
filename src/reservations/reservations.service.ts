import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ReservationStatus } from '@prisma/client';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateReservationDto) {
    const { inventoryId, quantity, expiresAt } = dto;

    return this.prisma.$transaction(async (tx) => {
      // 1. Load the inventory record
      const inventory = await tx.inventory.findUnique({
        where: { id: inventoryId },
      });

      if (!inventory) {
        throw new NotFoundException(`Inventory record with ID ${inventoryId} not found`);
      }

      // 2. Conditional atomic update — only increments reserved when sufficient
      //    stock is available. Returns 0 rows if another request already consumed it.
      const updated = await tx.inventory.updateMany({
        where: {
          id: inventoryId,
          // available (stock - reserved) >= quantity
          stock: { gte: inventory.reserved + quantity },
        },
        data: { reserved: { increment: quantity } },
      });

      if (updated.count === 0) {
        throw new UnprocessableEntityException(
          `Insufficient available stock for inventory ${inventoryId}. ` +
            `Available: ${inventory.stock - inventory.reserved}, requested: ${quantity}`,
        );
      }

      // 3. Create the reservation record
      return tx.reservation.create({
        data: {
          inventoryId,
          quantity,
          status: ReservationStatus.ACTIVE,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
        include: { inventory: true },
      });
    });
  }

  async findOne(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { inventory: true },
    });

    if (!reservation) {
      throw new NotFoundException(`Reservation with ID ${id} not found`);
    }

    return reservation;
  }

  async release(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await this.assertActiveReservation(tx, id);

      // Decrement reserved — stock stays untouched
      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: { reserved: { decrement: reservation.quantity } },
      });

      return tx.reservation.update({
        where: { id },
        data: {
          status: ReservationStatus.RELEASED,
          releasedAt: new Date(),
        },
        include: { inventory: true },
      });
    });
  }

  async complete(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await this.assertActiveReservation(tx, id);

      // Decrement both stock AND reserved — the sale is now confirmed
      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: {
          stock: { decrement: reservation.quantity },
          reserved: { decrement: reservation.quantity },
        },
      });

      return tx.reservation.update({
        where: { id },
        data: {
          status: ReservationStatus.COMPLETED,
          completedAt: new Date(),
        },
        include: { inventory: true },
      });
    });
  }

  /**
   * Fetches the reservation inside the given transaction and asserts it is ACTIVE.
   * Throws ConflictException if the reservation is already in a terminal state.
   * This helper is shared by release() and complete() to keep transition logic DRY.
   */
  private async assertActiveReservation(tx: Prisma.TransactionClient, id: string) {
    const reservation = await tx.reservation.findUnique({ where: { id } });

    if (!reservation) {
      throw new NotFoundException(`Reservation with ID ${id} not found`);
    }

    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new ConflictException(
        `Reservation ${id} is already in a terminal state: ${reservation.status}. ` +
          `Only ACTIVE reservations can be transitioned.`,
      );
    }

    return reservation;
  }
}
