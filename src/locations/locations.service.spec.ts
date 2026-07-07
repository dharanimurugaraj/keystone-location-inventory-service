import { Test, TestingModule } from '@nestjs/testing';
import { LocationsService } from './locations.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrismaService = {
  location: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

describe('LocationsService', () => {
  let service: LocationsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<LocationsService>(LocationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a location', async () => {
    const createDto = {
      name: 'Loc1',
      city: 'City1',
      state: 'State1',
      pincodes: ['123'],
      priority: 1,
      isActive: true,
    };
    const result = { id: 'uuid-1', ...createDto, createdAt: new Date(), updatedAt: new Date() };
    mockPrismaService.location.create.mockResolvedValue(result);

    const location = await service.create(createDto);
    expect(location.id).toEqual('uuid-1');
    expect(prisma.location.create).toHaveBeenCalledWith({ data: createDto });
  });

  it('should find all locations', async () => {
    mockPrismaService.location.findMany.mockResolvedValue([]);
    const locations = await service.findAll();
    expect(locations).toEqual([]);
    expect(prisma.location.findMany).toHaveBeenCalled();
  });
});
