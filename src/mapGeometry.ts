import type { LatLngExpression } from 'leaflet'

/**
 * Temporary presentation geometry for the six shared corridor IDs.
 * Replace this adapter with Member A/B GeoJSON coordinates when available;
 * scores, simulation results, and corridor metadata remain canonical elsewhere.
 */
export const corridorGeometry: Record<string, LatLngExpression[]> = {
  'eglinton-east': [
    [43.7343, -79.2636], [43.7361, -79.2521], [43.7384, -79.2402],
    [43.7401, -79.228], [43.7387, -79.215],
  ],
  'jane-north': [
    [43.7654, -79.5201], [43.7512, -79.5165], [43.7372, -79.513],
    [43.7234, -79.5101], [43.711, -79.5067],
  ],
  'dufferin-gap': [
    [43.6778, -79.4432], [43.6682, -79.4411], [43.6575, -79.4377],
    [43.6472, -79.4331], [43.6371, -79.4273],
  ],
  'don-mills-south': [
    [43.7189, -79.337], [43.7081, -79.3342], [43.6982, -79.3328],
    [43.6887, -79.3347], [43.681, -79.337],
  ],
  'lawrence-east': [
    [43.7451, -79.3105], [43.7514, -79.282], [43.7576, -79.252],
    [43.7635, -79.221], [43.7684, -79.191],
  ],
  'kipling-south': [
    [43.6402, -79.5351], [43.6304, -79.531], [43.6198, -79.5272],
    [43.6104, -79.524], [43.6021, -79.5205],
  ],
}
