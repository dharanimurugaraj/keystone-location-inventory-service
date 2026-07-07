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
import { CheckoutsService } from './checkouts.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@ApiTags('checkouts')
@Controller('checkouts')
export class CheckoutsController {
  constructor(private readonly checkoutsService: CheckoutsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a checkout',
    description:
      'Selects the best warehouse for the delivery pincode using the two-step PRD §5 algorithm ' +
      '(service-zone match → city → state → any active), then atomically reserves the requested ' +
      'quantity from that warehouse. Returns the new checkout in PENDING_PAYMENT state. ' +
      'Returns 422 if no qualifying warehouse has sufficient stock.',
  })
  @ApiResponse({ status: 201, description: 'Checkout created; stock reserved.' })
  @ApiResponse({ status: 400, description: 'Invalid input (DTO validation failed).' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  @ApiResponse({
    status: 422,
    description: 'No location can fulfill the order (insufficient stock across all candidates).',
  })
  create(@Body() createCheckoutDto: CreateCheckoutDto) {
    return this.checkoutsService.create(createCheckoutDto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a checkout by ID',
    description:
      'Returns the checkout record including its linked product, location, and reservation details.',
  })
  @ApiParam({ name: 'id', description: 'Checkout ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Checkout found.' })
  @ApiResponse({ status: 400, description: 'Invalid UUID format.' })
  @ApiResponse({ status: 404, description: 'Checkout not found.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.checkoutsService.findOne(id);
  }
}
