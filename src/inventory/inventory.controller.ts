import { Controller, Get, Post, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { AddInventoryDto } from './dto/add-inventory.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @ApiOperation({ summary: 'Add inventory for a product at a location' })
  @ApiResponse({ status: 201, description: 'The inventory has been successfully added.' })
  @ApiResponse({ status: 404, description: 'Product or Location not found.' })
  @ApiResponse({ status: 400, description: 'Invalid input.' })
  addInventory(@Body() addInventoryDto: AddInventoryDto) {
    return this.inventoryService.addInventory(addInventoryDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all inventory records' })
  @ApiResponse({ status: 200, description: 'Return all inventory records.' })
  findAll() {
    return this.inventoryService.findAll();
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Get inventory for a specific product' })
  @ApiParam({ name: 'productId', description: 'Product ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Return inventory for the product.' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  @ApiResponse({ status: 400, description: 'Invalid UUID format.' })
  findByProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.inventoryService.findByProduct(productId);
  }

  @Get('location/:locationId')
  @ApiOperation({ summary: 'Get inventory for a specific location' })
  @ApiParam({ name: 'locationId', description: 'Location ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Return inventory for the location.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  @ApiResponse({ status: 400, description: 'Invalid UUID format.' })
  findByLocation(@Param('locationId', ParseUUIDPipe) locationId: string) {
    return this.inventoryService.findByLocation(locationId);
  }
}
