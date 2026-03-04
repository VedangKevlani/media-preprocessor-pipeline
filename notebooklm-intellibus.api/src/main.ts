import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true, // allow all origins in dev (5173, 5174, etc.)
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
