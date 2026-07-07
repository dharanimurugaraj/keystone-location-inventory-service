import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';

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

  it('should find all products', async () => {
    mockPrismaService.product.findMany.mockResolvedValue([]);
    const products = await service.findAll();
    expect(products).toEqual([]);
    expect(prisma.product.findMany).toHaveBeenCalled();
  });

  it('should find a product by id', async () => {
    mockPrismaService.product.findUnique.mockResolvedValue({ id: 'uuid-123', name: 'Test' });
    const product = await service.findOne('uuid-123');
    expect(product.id).toEqual('uuid-123');
    expect(prisma.product.findUnique).toHaveBeenCalledWith({ where: { id: 'uuid-123' } });
  });
});
