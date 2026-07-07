import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@ApiTags('reservations')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a reservation',
    description:
      'Atomically reserves the requested quantity from the specified inventory record. ' +
      'Returns 422 if available stock is insufficient. ' +
      'Increments inventory.reserved; inventory.stock is unchanged.',
  })
  @ApiResponse({ status: 201, description: 'Reservation created successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid input (validation failed).' })
  @ApiResponse({ status: 404, description: 'Inventory record not found.' })
  @ApiResponse({ status: 422, description: 'Insufficient available stock.' })
  create(@Body() createReservationDto: CreateReservationDto) {
    return this.reservationsService.create(createReservationDto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a reservation by ID',
    description: 'Returns the reservation record including its linked inventory details.',
  })
  @ApiParam({ name: 'id', description: 'Reservation ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Reservation found.' })
  @ApiResponse({ status: 400, description: 'Invalid UUID format.' })
  @ApiResponse({ status: 404, description: 'Reservation not found.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservationsService.findOne(id);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Release a reservation',
    description:
      'Releases an ACTIVE reservation, returning the reserved quantity to available stock. ' +
      'Decrements inventory.reserved; inventory.stock is unchanged. ' +
      'Transitions reservation status to RELEASED (terminal). ' +
      'Returns 409 if the reservation is already in a terminal state.',
  })
  @ApiParam({ name: 'id', description: 'Reservation ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Reservation released successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid UUID format.' })
  @ApiResponse({ status: 404, description: 'Reservation not found.' })
  @ApiResponse({ status: 409, description: 'Reservation is already in a terminal state.' })
  release(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservationsService.release(id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a reservation',
    description:
      'Completes an ACTIVE reservation, confirming the sale. ' +
      'Decrements both inventory.stock and inventory.reserved by the reserved quantity. ' +
      'Transitions reservation status to COMPLETED (terminal). ' +
      'Returns 409 if the reservation is already in a terminal state.',
  })
  @ApiParam({ name: 'id', description: 'Reservation ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Reservation completed successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid UUID format.' })
  @ApiResponse({ status: 404, description: 'Reservation not found.' })
  @ApiResponse({ status: 409, description: 'Reservation is already in a terminal state.' })
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservationsService.complete(id);
  }
}
