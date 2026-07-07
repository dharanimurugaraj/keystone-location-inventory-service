import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CheckoutsService } from './checkouts.service';
import { LocationSelectionService } from './location-selection.service';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutStatus, ReservationStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const mock = {
    product: {
      findUnique: jest.fn(),
    },
    inventory: {
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    reservation: {
      create: jest.fn(),
      update: jest.fn(),
    },
    checkout: {
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

const makeMockLocationSelection = () => ({
  selectLocation: jest.fn(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CheckoutsService', () => {
  let service: CheckoutsService;
  let prisma: ReturnType<typeof makeMockPrisma>;
  let locationSelection: ReturnType<typeof makeMockLocationSelection>;

  beforeEach(async () => {
    prisma = makeMockPrisma();
    locationSelection = makeMockLocationSelection();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LocationSelectionService, useValue: locationSelection },
      ],
    }).compile();

    service = module.get<CheckoutsService>(CheckoutsService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    const validDto = {
      productId: 'prod-1',
      quantity: 5,
      deliveryPincode: '560001',
      deliveryCity: 'Bangalore',
      deliveryState: 'Karnataka',
    };

    it('orchestrates selection and reserves atomically', async () => {
      // 1. Product exists
      prisma.product.findUnique.mockResolvedValue({ id: 'prod-1' });

      // 2. Selection succeeds
      locationSelection.selectLocation.mockResolvedValue({
        id: 'inv-1',
        locationId: 'loc-1',
        stock: 100,
        reserved: 10,
      });

      // 3. Transaction steps
      prisma.inventory.updateMany.mockResolvedValue({ count: 1 });
      prisma.reservation.create.mockResolvedValue({ id: 'res-1' });
      prisma.checkout.create.mockResolvedValue({
        id: 'chk-1',
        status: CheckoutStatus.PENDING_PAYMENT,
      });

      const result = await service.create(validDto);

      expect(result.id).toBe('chk-1');

      // Verify product check
      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
      });

      // Verify selection parameters
      expect(locationSelection.selectLocation).toHaveBeenCalledWith(
        'prod-1',
        5,
        '560001',
        'Bangalore',
        'Karnataka',
      );

      // Verify atomic stock guard
      expect(prisma.inventory.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'inv-1',
          stock: { gte: 10 + 5 }, // reserved (10) + requested (5)
        },
        data: { reserved: { increment: 5 } },
      });

      // Verify checkout creation payload
      expect(prisma.checkout.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            productId: 'prod-1',
            locationId: 'loc-1',
            reservationId: 'res-1',
            quantity: 5,
            status: CheckoutStatus.PENDING_PAYMENT,
            deliveryPincode: '560001',
            deliveryCity: 'Bangalore',
            deliveryState: 'Karnataka',
          },
        }),
      );
    });

    it('throws NotFoundException when product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.create(validDto)).rejects.toThrow(NotFoundException);
      expect(locationSelection.selectLocation).not.toHaveBeenCalled();
    });

    it('throws Error when concurrent request consumes stock (updateMany returns 0)', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'prod-1' });
      locationSelection.selectLocation.mockResolvedValue({
        id: 'inv-1',
        locationId: 'loc-1',
        stock: 10,
        reserved: 0,
      });

      // Simulate the conditional update failing (stock was consumed in a race)
      prisma.inventory.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.create(validDto)).rejects.toThrow(/Stock was consumed concurrently/);
      expect(prisma.reservation.create).not.toHaveBeenCalled();
      expect(prisma.checkout.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // findOne()
  // -------------------------------------------------------------------------
  describe('findOne()', () => {
    it('returns the checkout when it exists', async () => {
      prisma.checkout.findUnique.mockResolvedValue({ id: 'chk-1' });
      const result = await service.findOne('chk-1');
      expect(result.id).toBe('chk-1');
    });

    it('throws NotFoundException when checkout does not exist', async () => {
      prisma.checkout.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // markPaymentSuccessful()
  // -------------------------------------------------------------------------
  describe('markPaymentSuccessful()', () => {
    const mockCheckout = (overrides: Record<string, unknown> = {}) => ({
      id: 'chk-1',
      reservationId: 'res-1',
      quantity: 5,
      status: CheckoutStatus.PENDING_PAYMENT,
      reservation: {
        id: 'res-1',
        inventoryId: 'inv-1',
        status: ReservationStatus.ACTIVE,
      },
      ...overrides,
    });

    it('processes successful payment and updates inventory atomically', async () => {
      const checkout = mockCheckout();
      prisma.checkout.findUnique.mockResolvedValue(checkout);

      await service.markPaymentSuccessful('chk-1');

      // Verify inventory stock and reserved were both decremented
      expect(prisma.inventory.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          stock: { decrement: 5 },
          reserved: { decrement: 5 },
        },
      });

      // Verify reservation was completed
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: {
          status: ReservationStatus.COMPLETED,
          completedAt: expect.any(Date),
        },
      });

      // Verify checkout was marked SUCCEEDED
      expect(prisma.checkout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'chk-1' },
          data: { status: CheckoutStatus.SUCCEEDED },
        }),
      );
    });

    it('is idempotent on repeated SUCCESS calls', async () => {
      const checkout = mockCheckout({ status: CheckoutStatus.SUCCEEDED });
      prisma.checkout.findUnique.mockResolvedValue(checkout);

      await service.markPaymentSuccessful('chk-1');

      // Inventory/Reservation/Checkout updates should NOT be called
      expect(prisma.inventory.update).not.toHaveBeenCalled();
      expect(prisma.reservation.update).not.toHaveBeenCalled();
      expect(prisma.checkout.update).not.toHaveBeenCalled();
      // It should just refetch the checkout
      expect(prisma.checkout.findUnique).toHaveBeenCalledTimes(2);
    });

    it('throws ConflictException if checkout is FAILED', async () => {
      const checkout = mockCheckout({ status: CheckoutStatus.FAILED });
      prisma.checkout.findUnique.mockResolvedValue(checkout);

      await expect(service.markPaymentSuccessful('chk-1')).rejects.toThrow(
        import('@nestjs/common').ConflictException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // markPaymentFailed()
  // -------------------------------------------------------------------------
  describe('markPaymentFailed()', () => {
    const mockCheckout = (overrides: Record<string, unknown> = {}) => ({
      id: 'chk-1',
      reservationId: 'res-1',
      quantity: 5,
      status: CheckoutStatus.PENDING_PAYMENT,
      reservation: {
        id: 'res-1',
        inventoryId: 'inv-1',
        status: ReservationStatus.ACTIVE,
      },
      ...overrides,
    });

    it('processes failed payment and releases reserved inventory atomically', async () => {
      const checkout = mockCheckout();
      prisma.checkout.findUnique.mockResolvedValue(checkout);

      await service.markPaymentFailed('chk-1');

      // Verify only reserved was decremented (stock unchanged)
      expect(prisma.inventory.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          reserved: { decrement: 5 },
        },
      });

      // Verify reservation was released
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: {
          status: ReservationStatus.RELEASED,
          releasedAt: expect.any(Date),
        },
      });

      // Verify checkout was marked FAILED
      expect(prisma.checkout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'chk-1' },
          data: { status: CheckoutStatus.FAILED },
        }),
      );
    });

    it('is idempotent on repeated FAILED calls', async () => {
      const checkout = mockCheckout({ status: CheckoutStatus.FAILED });
      prisma.checkout.findUnique.mockResolvedValue(checkout);

      await service.markPaymentFailed('chk-1');

      // Updates should NOT be called
      expect(prisma.inventory.update).not.toHaveBeenCalled();
      expect(prisma.reservation.update).not.toHaveBeenCalled();
      expect(prisma.checkout.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException if checkout is SUCCEEDED', async () => {
      const checkout = mockCheckout({ status: CheckoutStatus.SUCCEEDED });
      prisma.checkout.findUnique.mockResolvedValue(checkout);

      await expect(service.markPaymentFailed('chk-1')).rejects.toThrow(
        import('@nestjs/common').ConflictException,
      );
    });
  });
});
