import { Module } from '@nestjs/common';
import { CheckoutsController } from './checkouts.controller';
import { CheckoutsService } from './checkouts.service';
import { LocationSelectionService } from './location-selection.service';

@Module({
  controllers: [CheckoutsController],
  providers: [CheckoutsService, LocationSelectionService],
  exports: [CheckoutsService],
})
export class CheckoutsModule {}
