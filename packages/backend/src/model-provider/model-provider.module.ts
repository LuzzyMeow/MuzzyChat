import { Module } from "@nestjs/common";
import { ModelProviderController } from "./model-provider.controller";
import { ModelProviderService } from "./model-provider.service";

@Module({
  controllers: [ModelProviderController],
  providers: [ModelProviderService],
  exports: [ModelProviderService],
})
export class ModelProviderModule {}
