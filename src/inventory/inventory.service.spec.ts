import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InventoryService, withAvailable } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeRawInventory = (overrides: object = {}) => ({
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
  inventory: {
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
  },
  location: {
    findUnique: jest.fn(),
  },
};

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // withAvailable() — standalone derivation helper
  // -------------------------------------------------------------------------
  describe('withAvailable()', () => {
    it('computes available = stock - reserved', () => {
      const result = withAvailable(makeRawInventory({ stock: 100, reserved: 10 }));
      expect(result.available).toBe(90);
    });

    it('returns 0 when all stock is reserved', () => {
      const result = withAvailable(makeRawInventory({ stock: 50, reserved: 50 }));
      expect(result.available).toBe(0);
    });

    it('preserves all original fields', () => {
      const raw = makeRawInventory({ stock: 80, reserved: 30 });
      const result = withAvailable(raw);
      expect(result.available).toBe(50);
      expect(result.id).toBe('inv-1');
      expect(result.stock).toBe(80);
      expect(result.reserved).toBe(30);
    });
  });

  // -------------------------------------------------------------------------
  // addInventory()
  // -------------------------------------------------------------------------
  describe('addInventory()', () => {
    it('should add inventory and return record with derived available', async () => {
      const raw = makeRawInventory({ stock: 10, reserved: 0 });
      mockPrismaService.product.findUnique.mockResolvedValue({ id: 'prod-1' });
      mockPrismaService.location.findUnique.mockResolvedValue({ id: 'loc-1' });
      mockPrismaService.inventory.upsert.mockResolvedValue(raw);

      const result = await service.addInventory({
        productId: 'prod-1',
        locationId: 'loc-1',
        quantity: 10,
      });

      expect(result.stock).toEqual(10);
      expect(result.available).toEqual(10); // 10 - 0
      expect(mockPrismaService.inventory.upsert).toHaveBeenCalled();
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue(null);

      await expect(
        service.addInventory({ productId: 'missing', locationId: 'loc-1', quantity: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when location does not exist', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({ id: 'prod-1' });
      mockPrismaService.location.findUnique.mockResolvedValue(null);

      await expect(
        service.addInventory({ productId: 'prod-1', locationId: 'missing', quantity: 5 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // findAll()
  // -------------------------------------------------------------------------
  describe('findAll()', () => {
    it('returns all inventory records with available derived for each', async () => {
      const recs = [
        makeRawInventory({ stock: 100, reserved: 10 }),
        makeRawInventory({ id: 'inv-2', stock: 50, reserved: 50 }),
      ];
      mockPrismaService.inventory.findMany.mockResolvedValue(recs);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].available).toBe(90); // 100 - 10
      expect(result[1].available).toBe(0); // 50 - 50
    });
  });

  // -------------------------------------------------------------------------
  // findByProduct()
  // -------------------------------------------------------------------------
  describe('findByProduct()', () => {
    it('returns records with available for the given product', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue({ id: 'prod-1' });
      const recs = [makeRawInventory({ stock: 200, reserved: 75 })];
      mockPrismaService.inventory.findMany.mockResolvedValue(recs);

      const result = await service.findByProduct('prod-1');

      expect(result).toHaveLength(1);
      expect(result[0].available).toBe(125); // 200 - 75
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrismaService.product.findUnique.mockResolvedValue(null);

      await expect(service.findByProduct('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // findByLocation()
  // -------------------------------------------------------------------------
  describe('findByLocation()', () => {
    it('returns records with available for the given location', async () => {
      mockPrismaService.location.findUnique.mockResolvedValue({ id: 'loc-1' });
      const recs = [makeRawInventory({ stock: 60, reserved: 20 })];
      mockPrismaService.inventory.findMany.mockResolvedValue(recs);

      const result = await service.findByLocation('loc-1');

      expect(result).toHaveLength(1);
      expect(result[0].available).toBe(40); // 60 - 20
    });

    it('throws NotFoundException when location does not exist', async () => {
      mockPrismaService.location.findUnique.mockResolvedValue(null);

      await expect(service.findByLocation('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
