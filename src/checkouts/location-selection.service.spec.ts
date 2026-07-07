import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { LocationSelectionService } from './location-selection.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeLocation = (
  overrides: Partial<{
    id: string;
    city: string;
    state: string;
    pincodes: string[];
    priority: number;
    isActive: boolean;
  }> = {},
) => ({
  id: 'loc-1',
  name: 'Warehouse A',
  city: 'Bangalore',
  state: 'Karnataka',
  pincodes: ['560001', '560002'],
  priority: 1,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeInventoryRow = (
  overrides: Partial<{
    id: string;
    locationId: string;
    stock: number;
    reserved: number;
    location: ReturnType<typeof makeLocation>;
  }> = {},
) => ({
  id: 'inv-1',
  productId: 'prod-1',
  locationId: 'loc-1',
  stock: 100,
  reserved: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
  location: makeLocation(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------
const buildMockPrisma = () => ({
  inventory: {
    findMany: jest.fn(),
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('LocationSelectionService', () => {
  let service: LocationSelectionService;
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LocationSelectionService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<LocationSelectionService>(LocationSelectionService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // PRD §5 Example A — Service zone hit, single match
  // -------------------------------------------------------------------------
  it('Example A: picks the location whose service zone covers the pincode', async () => {
    const row = makeInventoryRow({ stock: 100, reserved: 10 }); // available = 90
    prisma.inventory.findMany.mockResolvedValue([row]);

    const result = await service.selectLocation('prod-1', 5, '560001', 'Other City', 'Other State');

    expect(result.locationId).toBe('loc-1');
  });

  // -------------------------------------------------------------------------
  // PRD §5 Example A — Service zone tie-break by lowest priority
  // -------------------------------------------------------------------------
  it('Example A (tie-break): picks lowest priority number when multiple service-zone locations qualify', async () => {
    const highPriority = makeInventoryRow({
      id: 'inv-1',
      locationId: 'loc-1',
      stock: 100,
      reserved: 0,
      location: makeLocation({ id: 'loc-1', priority: 2, pincodes: ['560001'] }),
    });
    const lowPriority = makeInventoryRow({
      id: 'inv-2',
      locationId: 'loc-2',
      stock: 100,
      reserved: 0,
      location: makeLocation({ id: 'loc-2', priority: 1, pincodes: ['560001'] }),
    });
    prisma.inventory.findMany.mockResolvedValue([highPriority, lowPriority]);

    const result = await service.selectLocation('prod-1', 5, '560001', 'Other City', 'Other State');

    expect(result.locationId).toBe('loc-2'); // priority 1 wins
  });

  // -------------------------------------------------------------------------
  // PRD §5 Example B — Service zone match, insufficient stock at preferred
  // -------------------------------------------------------------------------
  it('Example B: skips service-zone location with insufficient stock', async () => {
    // loc-1: serves 560001 but only has 2 available — not enough for qty 5
    const tooLittle = makeInventoryRow({
      id: 'inv-1',
      locationId: 'loc-1',
      stock: 12,
      reserved: 10, // available = 2
      location: makeLocation({ id: 'loc-1', priority: 1, pincodes: ['560001'] }),
    });
    // loc-2: also serves 560001 and has 50 available
    const enough = makeInventoryRow({
      id: 'inv-2',
      locationId: 'loc-2',
      stock: 60,
      reserved: 10, // available = 50
      location: makeLocation({ id: 'loc-2', priority: 2, pincodes: ['560001'] }),
    });
    prisma.inventory.findMany.mockResolvedValue([tooLittle, enough]);

    const result = await service.selectLocation('prod-1', 5, '560001', 'Other City', 'Other State');

    // loc-1 is excluded (insufficient); loc-2 is the only service-zone match
    expect(result.locationId).toBe('loc-2');
  });

  // -------------------------------------------------------------------------
  // PRD §5 Example C — Fallback to city
  // -------------------------------------------------------------------------
  it('Example C: falls back to same city when no service-zone location qualifies', async () => {
    // loc-1: does NOT serve pincode 999999 but is in the same city
    const cityRow = makeInventoryRow({
      id: 'inv-1',
      locationId: 'loc-1',
      stock: 100,
      reserved: 0,
      location: makeLocation({
        id: 'loc-1',
        city: 'Pune',
        state: 'Maharashtra',
        pincodes: ['411001'], // does NOT include 999999
        priority: 1,
      }),
    });
    prisma.inventory.findMany.mockResolvedValue([cityRow]);

    const result = await service.selectLocation('prod-1', 5, '999999', 'Pune', 'Maharashtra');

    expect(result.locationId).toBe('loc-1');
  });

  // -------------------------------------------------------------------------
  // PRD §5 Example D — Fallback to state
  // -------------------------------------------------------------------------
  it('Example D: falls back to same state when no city match exists', async () => {
    // loc-1: wrong pincode, wrong city, but same state
    const stateRow = makeInventoryRow({
      id: 'inv-1',
      locationId: 'loc-1',
      stock: 100,
      reserved: 0,
      location: makeLocation({
        id: 'loc-1',
        city: 'Nashik', // different from 'Pune'
        state: 'Maharashtra',
        pincodes: ['422001'], // different from '999999'
        priority: 1,
      }),
    });
    prisma.inventory.findMany.mockResolvedValue([stateRow]);

    const result = await service.selectLocation('prod-1', 5, '999999', 'Pune', 'Maharashtra');

    expect(result.locationId).toBe('loc-1');
  });

  // -------------------------------------------------------------------------
  // PRD §5 Example E — Fallback to any active
  // -------------------------------------------------------------------------
  it('Example E: falls back to any active location when no city or state match exists', async () => {
    // loc-1: completely different geography, but active and has stock
    const anyRow = makeInventoryRow({
      id: 'inv-1',
      locationId: 'loc-1',
      stock: 100,
      reserved: 0,
      location: makeLocation({
        id: 'loc-1',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincodes: ['400001'],
        priority: 1,
      }),
    });
    prisma.inventory.findMany.mockResolvedValue([anyRow]);

    const result = await service.selectLocation('prod-1', 5, '999999', 'Chennai', 'Tamil Nadu');

    expect(result.locationId).toBe('loc-1');
  });

  // -------------------------------------------------------------------------
  // No qualifying location — no stock anywhere
  // -------------------------------------------------------------------------
  it('throws UnprocessableEntityException when no location has sufficient stock', async () => {
    const exhausted = makeInventoryRow({
      stock: 4,
      reserved: 4, // available = 0
    });
    prisma.inventory.findMany.mockResolvedValue([exhausted]);

    await expect(
      service.selectLocation('prod-1', 5, '560001', 'Bangalore', 'Karnataka'),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // -------------------------------------------------------------------------
  // No qualifying location — no inventory at all for this product
  // -------------------------------------------------------------------------
  it('throws UnprocessableEntityException when product has no inventory', async () => {
    prisma.inventory.findMany.mockResolvedValue([]);

    await expect(
      service.selectLocation('prod-1', 1, '560001', 'Bangalore', 'Karnataka'),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // -------------------------------------------------------------------------
  // Inactive locations are excluded
  // -------------------------------------------------------------------------
  it('excludes inactive locations from selection', async () => {
    // The DB query already filters isActive=true in the WHERE clause,
    // but we verify the service behaves correctly when findMany returns
    // no rows (because Prisma filtered them out).
    prisma.inventory.findMany.mockResolvedValue([]); // all inactive, so no rows returned

    await expect(
      service.selectLocation('prod-1', 1, '560001', 'Bangalore', 'Karnataka'),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // -------------------------------------------------------------------------
  // Service zone preferred over fallback even with lower quantity available
  // -------------------------------------------------------------------------
  it('prefers service-zone match over a city-fallback location with more stock', async () => {
    const serviceZone = makeInventoryRow({
      id: 'inv-1',
      locationId: 'loc-zone',
      stock: 20,
      reserved: 10, // available = 10 — sufficient
      location: makeLocation({
        id: 'loc-zone',
        city: 'Other City',
        state: 'Other State',
        pincodes: ['560001'], // serves the pincode
        priority: 5,
      }),
    });
    const cityFallback = makeInventoryRow({
      id: 'inv-2',
      locationId: 'loc-city',
      stock: 200,
      reserved: 0, // available = 200 — much more stock
      location: makeLocation({
        id: 'loc-city',
        city: 'Bangalore',
        state: 'Karnataka',
        pincodes: ['999999'], // does NOT serve the delivery pincode
        priority: 1,
      }),
    });
    prisma.inventory.findMany.mockResolvedValue([serviceZone, cityFallback]);

    const result = await service.selectLocation('prod-1', 5, '560001', 'Bangalore', 'Karnataka');

    // Service-zone match wins regardless of stock amount or priority
    expect(result.locationId).toBe('loc-zone');
  });
});
