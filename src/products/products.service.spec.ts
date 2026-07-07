import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeInventoryRow = (overrides: object = {}) => ({
  id: 'inv-1',
  productId: 'prod-1',
  locationId: 'loc-1',
  stock: 100,
  reserved: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockPrismaService = {
  product: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  it('should create a product', async () => {
    const createDto = { name: 'Test Product', sku: 'SKU123' };
    const result = {
      id: 'uuid-123',
      ...createDto,
      createdAt: new Date(),
      updatedAt: new Date(),
      description: null,
    };
    mockPrismaService.product.create.mockResolvedValue(result);

    const product = await service.create(createDto);
    expect(product.id).toEqual('uuid-123');
    expect(prisma.product.create).toHaveBeenCalledWith({ data: createDto });
  });

  // -------------------------------------------------------------------------
  // findAll()
  // -------------------------------------------------------------------------
  it('should find all products', async () => {
    mockPrismaService.product.findMany.mockResolvedValue([]);
    const products = await service.findAll();
    expect(products).toEqual([]);
    expect(prisma.product.findMany).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // findOne()
  // -------------------------------------------------------------------------
  it('should find a product by id', async () => {
    mockPrismaService.product.findUnique.mockResolvedValue({ id: 'uuid-123', name: 'Test' });
    const product = await service.findOne('uuid-123');
    expect(product.id).toEqual('uuid-123');
    expect(prisma.product.findUnique).toHaveBeenCalledWith({ where: { id: 'uuid-123' } });
  });

  // -------------------------------------------------------------------------
  // getAvailability()
  // -------------------------------------------------------------------------
  describe('getAvailability()', () => {
    it('returns aggregate totals and per-location available', async () => {
      const inventories = [
        makeInventoryRow({ stock: 100, reserved: 10, locationId: 'loc-1' }), // available = 90
        makeInventoryRow({ id: 'inv-2', stock: 50, reserved: 20, locationId: 'loc-2' }), // available = 30
      ];
      mockPrismaService.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        name: 'Widget',
        sku: 'WID-001',
        inventories,
      });

      const result = await service.getAvailability('prod-1');

      expect(result.productId).toBe('prod-1');
      expect(result.totalStock).toBe(150); // 100 + 50
      expect(result.totalReserved).toBe(30); // 10 + 20
      expect(result.totalAvailable).toBe(120); // 90 + 30
      expect(result.locations).toHaveLength(2);
      expect(result.locations[0].available).toBe(90);
      expect(result.locations[1].available).toBe(30);
    });

    it('returns zero totals when product has no inventory', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({
        id: 'prod-empty',
        name: 'No Stock',
        sku: 'NS-001',
        inventories: [],
      });

      const result = await service.getAvailability('prod-empty');

      expect(result.totalStock).toBe(0);
      expect(result.totalReserved).toBe(0);
      expect(result.totalAvailable).toBe(0);
      expect(result.locations).toHaveLength(0);
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue(null);

      await expect(service.getAvailability('missing')).rejects.toThrow(NotFoundException);
    });

    it('invariant: totalAvailable always equals totalStock - totalReserved', async () => {
      const inventories = [
        makeInventoryRow({ stock: 300, reserved: 120, locationId: 'loc-1' }),
        makeInventoryRow({ id: 'inv-2', stock: 80, reserved: 80, locationId: 'loc-2' }),
      ];
      mockPrismaService.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        name: 'Widget',
        sku: 'WID-001',
        inventories,
      });

      const result = await service.getAvailability('prod-1');

      expect(result.totalAvailable).toBe(result.totalStock - result.totalReserved);
    });
  });
});
