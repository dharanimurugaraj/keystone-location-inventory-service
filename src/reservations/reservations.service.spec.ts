import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ReservationStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeInventory = (overrides: object = {}) => ({
  id: 'inv-1',
  productId: 'prod-1',
  locationId: 'loc-1',
  stock: 100,
  reserved: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeReservation = (overrides: object = {}) => ({
  id: 'res-1',
  inventoryId: 'inv-1',
  quantity: 5,
  status: ReservationStatus.ACTIVE,
  expiresAt: null,
  completedAt: null,
  releasedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  inventory: makeInventory(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mock Prisma — wraps $transaction so tests don't need a real DB
// ---------------------------------------------------------------------------
const buildMockPrisma = () => {
  const mock = {
    inventory: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    reservation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  // Default: execute the callback immediately with the mock itself as the tx
  mock.$transaction.mockImplementation((fn: (tx: typeof mock) => Promise<unknown>) => fn(mock));

  return mock;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ReservationsService', () => {
  let service: ReservationsService;
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReservationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ReservationsService>(ReservationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a reservation when stock is sufficient', async () => {
      const inventory = makeInventory({ stock: 100, reserved: 10 }); // available = 90
      const expectedReservation = makeReservation({ quantity: 5 });

      prisma.inventory.findUnique.mockResolvedValue(inventory);
      prisma.inventory.updateMany.mockResolvedValue({ count: 1 });
      prisma.reservation.create.mockResolvedValue(expectedReservation);

      const result = await service.create({ inventoryId: 'inv-1', quantity: 5 });

      expect(result.id).toBe('res-1');
      expect(result.status).toBe(ReservationStatus.ACTIVE);
      // Verify the conditional WHERE guard — reserved + qty must not exceed stock
      expect(prisma.inventory.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', stock: { gte: 10 + 5 } },
        data: { reserved: { increment: 5 } },
      });
    });

    it('throws NotFoundException when inventory does not exist', async () => {
      prisma.inventory.findUnique.mockResolvedValue(null);

      await expect(service.create({ inventoryId: 'nonexistent', quantity: 5 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws UnprocessableEntityException when available stock is insufficient', async () => {
      const inventory = makeInventory({ stock: 10, reserved: 8 }); // available = 2
      prisma.inventory.findUnique.mockResolvedValue(inventory);
      prisma.inventory.updateMany.mockResolvedValue({ count: 0 }); // conditional update fails

      await expect(service.create({ inventoryId: 'inv-1', quantity: 5 })).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('stores expiresAt when provided', async () => {
      const inventory = makeInventory();
      const expiresAt = '2026-12-31T00:00:00.000Z';
      prisma.inventory.findUnique.mockResolvedValue(inventory);
      prisma.inventory.updateMany.mockResolvedValue({ count: 1 });
      prisma.reservation.create.mockResolvedValue(makeReservation());

      await service.create({ inventoryId: 'inv-1', quantity: 5, expiresAt });

      expect(prisma.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expiresAt: new Date(expiresAt) }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // findOne()
  // -------------------------------------------------------------------------
  describe('findOne()', () => {
    it('returns the reservation when it exists', async () => {
      prisma.reservation.findUnique.mockResolvedValue(makeReservation());
      const result = await service.findOne('res-1');
      expect(result.id).toBe('res-1');
    });

    it('throws NotFoundException when reservation does not exist', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // release()
  // -------------------------------------------------------------------------
  describe('release()', () => {
    it('releases an ACTIVE reservation and decrements reserved', async () => {
      const reservation = makeReservation({ status: ReservationStatus.ACTIVE, quantity: 5 });
      const released = makeReservation({
        status: ReservationStatus.RELEASED,
        releasedAt: new Date(),
      });

      prisma.reservation.findUnique.mockResolvedValue(reservation);
      prisma.inventory.update.mockResolvedValue({});
      prisma.reservation.update.mockResolvedValue(released);

      const result = await service.release('res-1');

      expect(result.status).toBe(ReservationStatus.RELEASED);
      expect(prisma.inventory.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { reserved: { decrement: 5 } },
      });
    });

    it('throws ConflictException when reservation is already terminal', async () => {
      prisma.reservation.findUnique.mockResolvedValue(
        makeReservation({ status: ReservationStatus.COMPLETED }),
      );

      await expect(service.release('res-1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when reservation does not exist', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);
      await expect(service.release('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // complete()
  // -------------------------------------------------------------------------
  describe('complete()', () => {
    it('completes an ACTIVE reservation and decrements both stock and reserved', async () => {
      const reservation = makeReservation({ status: ReservationStatus.ACTIVE, quantity: 5 });
      const completed = makeReservation({
        status: ReservationStatus.COMPLETED,
        completedAt: new Date(),
      });

      prisma.reservation.findUnique.mockResolvedValue(reservation);
      prisma.inventory.update.mockResolvedValue({});
      prisma.reservation.update.mockResolvedValue(completed);

      const result = await service.complete('res-1');

      expect(result.status).toBe(ReservationStatus.COMPLETED);
      expect(prisma.inventory.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          stock: { decrement: 5 },
          reserved: { decrement: 5 },
        },
      });
    });

    it('throws ConflictException when reservation is already RELEASED', async () => {
      prisma.reservation.findUnique.mockResolvedValue(
        makeReservation({ status: ReservationStatus.RELEASED }),
      );

      await expect(service.complete('res-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when reservation is already EXPIRED', async () => {
      prisma.reservation.findUnique.mockResolvedValue(
        makeReservation({ status: ReservationStatus.EXPIRED }),
      );

      await expect(service.complete('res-1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when reservation does not exist', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);
      await expect(service.complete('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
