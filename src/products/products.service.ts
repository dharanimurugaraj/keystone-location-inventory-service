import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { withAvailable } from '../inventory/inventory.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto) {
    try {
      return await this.prisma.product.create({
        data: createProductDto,
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Product with this SKU already exists');
      }
      throw error;
    }
  }

  async findAll() {
    return this.prisma.product.findMany();
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  /**
   * Returns aggregate availability for a product across all locations.
   *
   * Each entry in `locations` contains the raw Inventory fields plus the
   * derived `available = stock - reserved` value.
   *
   * The top-level totals sum across every location so that callers can see
   * the overall picture without iterating themselves.
   */
  async getAvailability(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        inventories: true,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const locations = product.inventories.map(withAvailable);

    const totalStock = locations.reduce((sum, inv) => sum + inv.stock, 0);
    const totalReserved = locations.reduce((sum, inv) => sum + inv.reserved, 0);
    const totalAvailable = totalStock - totalReserved;

    return {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      totalStock,
      totalReserved,
      totalAvailable,
      locations,
    };
  }
}
