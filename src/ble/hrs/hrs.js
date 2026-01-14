
import { Service } from '../service.js';
import { uuids } from '../web-ble.js';
import { heartRateMeasurement } from './heart-rate-measurement.js';

export default function HRS(args = {}) {
    const spec = {
        measurement: {
            uuid: uuids.heartRateMeasurement,
            notify: { callback: args.onData, parser: heartRateMeasurement }
        }
    };

    return Service({
        service: args.service,
        spec
    });
}
