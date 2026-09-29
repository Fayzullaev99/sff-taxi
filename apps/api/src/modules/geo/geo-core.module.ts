import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { DriverTrackService } from './driver-track.service.js';
import { GeocodingService } from './geocoding.service.js';
import { GeoService } from './geo.service.js';
import { PickupEtaService } from './pickup-eta.service.js';
import { RouteFaresService } from './route-fares.service.js';
import { RoutingService } from './routing.service.js';

/** Geography services without HTTP routes, for modules that price, dispatch or track. */
@Module({
  imports: [SettingsModule],
  providers: [
    GeoService,
    RoutingService,
    GeocodingService,
    DriverTrackService,
    PickupEtaService,
    RouteFaresService,
  ],
  exports: [
    GeoService,
    RoutingService,
    GeocodingService,
    DriverTrackService,
    PickupEtaService,
    RouteFaresService,
  ],
})
export class GeoCoreModule {}
