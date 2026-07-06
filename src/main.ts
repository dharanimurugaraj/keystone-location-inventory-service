import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe — strips unknown properties and enforces DTO validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger / OpenAPI setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Keystone Location Inventory Service')
    .setDescription(
      'Location-based inventory reservation service API. ' +
        'Manages products, locations, and per-location inventory. ' +
        'Runs a checkout lifecycle that reserves stock from a single location, ' +
        'then resolves via payment success, failure, or abandonment.',
    )
    .setVersion('1.0')
    .addTag('Health', 'Service and database health checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
}

bootstrap();
