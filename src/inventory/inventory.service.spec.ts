import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';

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
  let prisma: PrismaService;

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
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should add inventory', async () => {
    mockPrismaService.product.findUnique.mockResolvedValue({ id: 'prod-1' });
    mockPrismaService.location.findUnique.mockResolvedValue({ id: 'loc-1' });
    mockPrismaService.inventory.upsert.mockResolvedValue({ id: 'inv-1', stock: 10 });

    const result = await service.addInventory({
      productId: 'prod-1',
      locationId: 'loc-1',
      quantity: 10,
    });
    expect(result.stock).toEqual(10);
    expect(prisma.inventory.upsert).toHaveBeenCalled();
  });
});
