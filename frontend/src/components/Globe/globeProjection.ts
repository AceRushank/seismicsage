import * as d3 from 'd3'

export type GeoRotation = [number, number, number]

/**
 * Create a configured geoOrthographic projection for the globe.
 * Used by both EarthGlobe (canvas draw) and QuakeMarkers (SVG overlay).
 */
export function createProjection(
  width: number,
  height: number,
  radius: number,
  rotation: GeoRotation,
): d3.GeoProjection {
  return d3
    .geoOrthographic()
    .scale(radius)
    .translate([width / 2, height / 2])
    .clipAngle(90)
    .rotate(rotation)
}

/**
 * Check whether a [lon, lat] point is on the visible hemisphere.
 *
 * The center of the visible hemisphere in geographic coordinates is at
 * [-rotation[0], -rotation[1]] because geoOrthographic rotates the globe
 * (not the camera). A positive dot product means the point faces the viewer.
 */
export function isVisible(lon: number, lat: number, rotation: GeoRotation): boolean {
  const centerLon = -rotation[0]
  const centerLat = -rotation[1]

  const clλ = (centerLon * Math.PI) / 180
  const clφ = (centerLat * Math.PI) / 180
  const pλ = (lon * Math.PI) / 180
  const pφ = (lat * Math.PI) / 180

  const dot =
    Math.cos(clφ) * Math.cos(pφ) * Math.cos(pλ - clλ) +
    Math.sin(clφ) * Math.sin(pφ)

  return dot > 0.05 // small positive margin avoids edge artefacts
}

/** Project [lon, lat] to screen [x, y] using the given projection. */
export function projectPoint(
  lon: number,
  lat: number,
  projection: d3.GeoProjection,
): [number, number] | null {
  const result = projection([lon, lat])
  return result ? [result[0], result[1]] : null
}
