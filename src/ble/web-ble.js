
export const uuids = {
    // Services
    fitnessMachine: '00001826-0000-1000-8000-00805f9b34fb',
    heartRate: '0000180d-0000-1000-8000-00805f9b34fb',
    cyclingPower: '00001818-0000-1000-8000-00805f9b34fb',
    speedCadence: '00001816-0000-1000-8000-00805f9b34fb',

    // Characteristics
    indoorBikeData: '00002ad2-0000-1000-8000-00805f9b34fb',
    fitnessMachineControlPoint: '00002ad9-0000-1000-8000-00805f9b34fb',
    fitnessMachineStatus: '00002ada-0000-1000-8000-00805f9b34fb',
    heartRateMeasurement: '00002a37-0000-1000-8000-00805f9b34fb',
    cscMeasurement: '00002a5b-0000-1000-8000-00805f9b34fb',
};

export const webBle = {
    filters: {
        zone2: () => ({
            filters: [
                { services: [uuids.fitnessMachine] },
                { services: [uuids.heartRate] }
            ],
            optionalServices: [uuids.cyclingPower, uuids.speedCadence]
        })
    },
    uuidToName: (uuid) => {
        return Object.keys(uuids).find(key => uuids[key] === uuid) || uuid;
    }
};
