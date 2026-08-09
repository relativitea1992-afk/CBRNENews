const extractStationStatus = (data, expectedTotal = 17) => {
    if (!data || !data.data || !data.data.stations || !data.data.readings) return { total: expectedTotal, active: 0, missing: [] };
    const stations = data.data.stations;
    const readings = data.data.readings;
    const total = Math.max(stations.length, expectedTotal);
    
    if (readings.length === 0) return { total, active: 0, missing: stations.map((s) => s.name) };

    const latestReading = readings[readings.length - 1];
    const readingData = latestReading?.data || [];
    const activeStationIds = new Set(readingData.map((d) => d.stationId));
    
    const missingStations = stations.filter((s) => !activeStationIds.has(s.id));
    
    const missingInfo = missingStations.map((station) => {
      let downSince = latestReading.timestamp;
      for (let i = readings.length - 1; i >= 0; i--) {
          const rData = readings[i].data || [];
          if (rData.some((d) => d.stationId === station.id)) {
              if (i + 1 < readings.length) downSince = readings[i + 1].timestamp;
              break;
          } else if (i === 0) {
              downSince = 'start of day';
          }
      }
      
      let timeStr = downSince;
      if (downSince.includes('T')) {
          timeStr = downSince.split('T')[1].substring(0, 5);
      }
      return `${station.name} since ${timeStr}`;
    });

    return { total, active: readingData.length, missing: missingInfo };
  };

  const extractPm25Status = (data) => {
    if (!data || !data.data || !data.data.items || data.data.items.length === 0) return { total: 5, active: 0, missing: ['all'] };
    const items = data.data.items;
    const latestReading = items[items.length - 1];
    const keys = Object.keys(latestReading?.readings?.pm25_one_hourly || {});
    const active = keys.length;
    
    const expectedRegions = ['north', 'south', 'east', 'west', 'central'];
    const missingRegions = expectedRegions.filter(r => !keys.includes(r));
    
    const missingInfo = missingRegions.map(region => {
      let downSince = latestReading.timestamp;
      for (let i = items.length - 1; i >= 0; i--) {
          const rKeys = Object.keys(items[i]?.readings?.pm25_one_hourly || {});
          if (rKeys.includes(region)) {
              if (i + 1 < items.length) downSince = items[i + 1].timestamp;
              break;
          } else if (i === 0) {
              downSince = 'start of day';
          }
      }
      
      let timeStr = downSince;
      if (downSince.includes('T')) {
          timeStr = downSince.split('T')[1].substring(0, 5);
      }
      return `${region} since ${timeStr}`;
    });

    return { total: 5, active, missing: missingInfo };
  };

const mockData = {
    data: {
        stations: [
            {id: 'S1', name: 'Station 1'},
            {id: 'S2', name: 'Station 2'},
            {id: 'S3', name: 'Station 3'}
        ],
        readings: [
            { timestamp: '2023-10-27T08:00:00+08:00', data: [{stationId: 'S1'}, {stationId: 'S2'}, {stationId: 'S3'}] },
            { timestamp: '2023-10-27T09:00:00+08:00', data: [{stationId: 'S1'}, {stationId: 'S3'}] }, // S2 drops
            { timestamp: '2023-10-27T10:00:00+08:00', data: [{stationId: 'S1'}] } // S3 drops
        ]
    }
};

const mockPm25 = {
    data: {
        items: [
            { timestamp: '2023-10-27T08:00:00+08:00', readings: { pm25_one_hourly: { north: 10, south: 10, east: 10, west: 10, central: 10 } } },
            { timestamp: '2023-10-27T09:00:00+08:00', readings: { pm25_one_hourly: { north: 10, south: 10, west: 10, central: 10 } } }, // east drops
            { timestamp: '2023-10-27T10:00:00+08:00', readings: { pm25_one_hourly: { north: 10, south: 10 } } } // west, central drops
        ]
    }
}

console.log("Station Status:", extractStationStatus(mockData, 3));
console.log("PM25 Status:", extractPm25Status(mockPm25));
