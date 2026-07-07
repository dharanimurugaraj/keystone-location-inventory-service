import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Inventory, Location } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** An Inventory row joined with its Location — used internally during selection. */
export type InventoryWithLocation = Inventory & { location: Location };

/**
 * LocationSelectionService
 *
 * Implements the two-step warehouse selection algorithm defined in PRD §5:
 *
 *   Step 1 — Service Zone Match
 *     Active locations whose service zone (pincodes array) contains the
 *     delivery pincode AND that have sufficient available stock.
 *     Tie-break: lowest priority number.
 *
 *   Step 2 — Fallback chain (only when Step 1 yields nothing)
 *     Same filter for active + sufficient stock, checked in order:
 *       a) same city
 *       b) same state
 *       c) any active location
 *     Stops at the first tier that yields at least one candidate.
 *     Tie-break within each tier: lowest priority number.
 *
 * The service is intentionally stateless and read-only — it only selects.
 * The caller (CheckoutsService) is responsible for reserving stock.
 */
@Injectable()
export class LocationSelectionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Selects the best inventory row from which the given quantity can be reserved.
   *
   * @param productId     - UUID of the product being purchased
   * @param quantity      - Units required (must be > 0)
   * @param deliveryPincode - Pincode of the delivery address
   * @param deliveryCity  - City of the delivery address
   * @param deliveryState - State of the delivery address
   * @returns The chosen InventoryWithLocation record
   * @throws UnprocessableEntityException if no location can fulfill the order
   */
  async selectLocation(
    productId: string,
    quantity: number,
    deliveryPincode: string,
    deliveryCity: string,
    deliveryState: string,
  ): Promise<InventoryWithLocation> {
    // Load all active inventory rows for this product, joined with their location.
    const rows = await this.prisma.inventory.findMany({
      where: {
        productId,
        location: { isActive: true },
      },
      include: { location: true },
    });

    // Build the candidate set: rows that can fulfill the full quantity.
    const candidates = rows.filter((row) => row.stock - row.reserved >= quantity);

    if (candidates.length === 0) {
      throw new UnprocessableEntityException(
        `No location can fulfill this order: insufficient available stock for product ${productId}`,
      );
    }

    // Step 1 — Service Zone Match
    const serviceZoneMatch = this.selectByPriority(
      candidates.filter((row) => row.location.pincodes.includes(deliveryPincode)),
    );
    if (serviceZoneMatch) return serviceZoneMatch;

    // Step 2a — City fallback
    const cityMatch = this.selectByPriority(
      candidates.filter((row) => row.location.city === deliveryCity),
    );
    if (cityMatch) return cityMatch;

    // Step 2b — State fallback
    const stateMatch = this.selectByPriority(
      candidates.filter((row) => row.location.state === deliveryState),
    );
    if (stateMatch) return stateMatch;

    // Step 2c — Any active location (candidates are already active+sufficient)
    const anyMatch = this.selectByPriority(candidates);
    if (anyMatch) return anyMatch;

    // This branch is unreachable given candidates.length > 0, but TypeScript requires it.
    throw new UnprocessableEntityException(
      `No location can fulfill this order for product ${productId}`,
    );
  }

  /**
   * Returns the candidate with the lowest priority number, or null for an empty list.
   * This is the universal tie-break rule applied at every selection tier.
   */
  private selectByPriority(candidates: InventoryWithLocation[]): InventoryWithLocation | null {
    if (candidates.length === 0) return null;
    return candidates.reduce((best, current) =>
      current.location.priority < best.location.priority ? current : best,
    );
  }
}
