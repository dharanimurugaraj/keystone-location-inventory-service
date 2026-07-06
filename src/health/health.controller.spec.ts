import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<Pick<HealthCheckService, 'check'>>;

  beforeEach(async () => {
    const mockCheck = jest.fn().mockResolvedValue({
      status: 'ok',
      info: { database: { status: 'up' } },
      error: {},
      details: { database: { status: 'up' } },
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: { check: mockCheck },
        },
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get(HealthCheckService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call healthCheckService.check', async () => {
    await controller.check();
    expect(healthCheckService.check).toHaveBeenCalledTimes(1);
  });

  it('should return a healthy status result', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.info?.['database']?.status).toBe('up');
  });
});
