import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddInventoryDto } from './dto/add-inventory.dto';

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

    // Upsert inventory
    return this.prisma.inventory.upsert({
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
  }

  async findAll() {
    return this.prisma.inventory.findMany();
  }

  async findByProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    return this.prisma.inventory.findMany({
      where: { productId },
    });
  }

  async findByLocation(locationId: string) {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundException(`Location with ID ${locationId} not found`);
    }

    return this.prisma.inventory.findMany({
      where: { locationId },
    });
  }
}
