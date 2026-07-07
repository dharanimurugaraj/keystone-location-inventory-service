import { Injectable, NotFoundException } from '@nestjs/common';
import { Inventory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddInventoryDto } from './dto/add-inventory.dto';

/** Appends the derived `available` field to any Inventory record. */
export function withAvailable<T extends Pick<Inventory, 'stock' | 'reserved'>>(
  record: T,
): T & { available: number } {
  return { ...record, available: record.stock - record.reserved };
}

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async addInventory(addInventoryDto: AddInventoryDto) {
    const { productId, locationId, quantity } = addInventoryDto;

    // Check if product exists
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    // Check if location exists
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundException(`Location with ID ${locationId} not found`);
    }

    // Upsert inventory and return with derived `available`
    const record = await this.prisma.inventory.upsert({
      where: {
        productId_locationId: {
          productId,
          locationId,
        },
      },
      update: {
        stock: {
          increment: quantity,
        },
      },
      create: {
        productId,
        locationId,
        stock: quantity,
        reserved: 0,
      },
    });

    return withAvailable(record);
  }

  async findAll() {
    const records = await this.prisma.inventory.findMany();
    return records.map(withAvailable);
  }

  async findByProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    const records = await this.prisma.inventory.findMany({
      where: { productId },
    });
    return records.map(withAvailable);
  }

  async findByLocation(locationId: string) {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundException(`Location with ID ${locationId} not found`);
    }

    const records = await this.prisma.inventory.findMany({
      where: { locationId },
    });
    return records.map(withAvailable);
  }
}
