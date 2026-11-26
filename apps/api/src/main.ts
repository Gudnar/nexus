import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { ExcelBodyLimit } from "./excel/limits";
import { AppConfig } from "./config";

async function bootstrap() {
  const trustProxy = new AppConfig().trustProxy;
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy, bodyLimit: ExcelBodyLimit }));
  app.enableShutdownHooks();
  await app.listen(app.get(AppConfig).port, "0.0.0.0");
}

void bootstrap();
