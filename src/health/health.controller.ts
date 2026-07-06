import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorStatus,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Check service and database health' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  check(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([() => this.checkDatabaseConnection()]);
  }

  private async checkDatabaseConnection(): Promise<HealthIndicatorResult> {
    const key = 'database';
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      const status: HealthIndicatorStatus = 'up';
      return { [key]: { status } };
    } catch {
      const status: HealthIndicatorStatus = 'down';
      return { [key]: { status } };
    }
  }
}
