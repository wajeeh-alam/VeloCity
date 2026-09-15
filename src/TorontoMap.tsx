import { useEffect, useRef } from 'react'
import L, { type LatLngExpression, type LayerGroup, type Map as LeafletMap } from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import 'leaflet/dist/leaflet.css'
import type { GeoLine, OpportunityProfile } from './data/opportunities.ts'

type TorontoMapProps = {
  opportunities: OpportunityProfile[]
  selected: OpportunityProfile
  activeIds: string[]
  built: boolean
  onSelect: (corridor: OpportunityProfile) => void
}

function coordinateIsValid(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
}

function geometryLines(geometry: GeoLine): LatLngExpression[][] {
  const coordinateLines = geometry.type === 'LineString'
    ? [geometry.coordinates]
    : geometry.coordinates

  return coordinateLines
    .filter(Array.isArray)
    .map((line) => line.filter(coordinateIsValid).map(([longitude, latitude]) => [latitude, longitude] as LatLngExpression))
    .filter((line) => line.length >= 2)
}

function hasDrawableCandidateRoute(opportunity: OpportunityProfile) {
  return opportunity.comparison.routeAlternatives.some((route) => (
    route.kind === 'official-candidate-alignment'
    && route.geometryRef === 'record.geometry'
  ))
}

export function TorontoMap({ opportunities, selected, activeIds, built, onSelect }: TorontoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const cyclingNetworkRef = useRef<L.GeoJSON | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [43.691, -79.386],
      zoom: 11,
      minZoom: 10,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: true,
    })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    mapRef.current = map

    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}data/toronto-cycling-network.geojson`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<GeoJsonObject> : Promise.reject())
      .then((network) => {
        if (mapRef.current !== map) return
        cyclingNetworkRef.current = L.geoJSON(network, {
          style: {
            color: '#3f3f46',
            weight: 1.7,
            opacity: 0.58,
            lineCap: 'round',
            lineJoin: 'round',
          },
          interactive: false,
          pane: 'overlayPane',
        }).addTo(map)
        cyclingNetworkRef.current.bringToBack()
      })
      .catch(() => { /* Keep the base map usable if the network snapshot is unavailable. */ })

    return () => {
      controller.abort()
      cyclingNetworkRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layerRef.current?.remove()
    const group = L.layerGroup().addTo(map)

    opportunities.forEach((opportunity) => {
      if (!hasDrawableCandidateRoute(opportunity)) return
      const lines = geometryLines(opportunity.geometry)
      const isSelected = opportunity.corridorId === selected.corridorId
      const isActive = activeIds.includes(opportunity.corridorId)
      const routeClasses = [
        isSelected ? 'leaflet-selected-route' : null,
        built && isSelected ? 'leaflet-built-route' : null,
      ].filter(Boolean).join(' ')

      lines.forEach((positions) => {
        const line = L.polyline(positions, {
          color: isSelected ? '#7067e8' : '#8d8d92',
          weight: isSelected ? (built ? 7 : 5) : 3,
          opacity: isSelected ? 1 : isActive ? 0.72 : 0.24,
          className: routeClasses || undefined,
        }).addTo(group)
        line.bindTooltip(`<strong>${opportunity.name}</strong><br>${opportunity.subtitle}`, { className: 'velocity-tooltip' })
        line.on('click', () => onSelect(opportunity))
      })
    })

    const selectedLines = hasDrawableCandidateRoute(selected) ? geometryLines(selected.geometry) : []
    const selectedPositions = selectedLines.flat()
    if (selectedPositions.length >= 2) {
      L.circleMarker(selectedPositions[0], { radius: 5, color: '#7067e8', fillColor: '#ffffff', fillOpacity: 1, weight: 2 }).addTo(group)
      L.circleMarker(selectedPositions[selectedPositions.length - 1], { radius: 5, color: '#7067e8', fillColor: '#7067e8', fillOpacity: 1, weight: 2 }).addTo(group)

      if (built) {
        selected.comparison.representativeAgents.slice(0, 8).forEach((agent, index) => {
          const position = selectedPositions[Math.floor(index * (selectedPositions.length - 1) / Math.max(selected.comparison.representativeAgents.length - 1, 1))]
          L.circleMarker(position, {
            radius: 3.2,
            color: '#ffffff',
            fillColor: '#7067e8',
            fillOpacity: 1,
            weight: 1,
            className: 'leaflet-agent',
          }).addTo(group).bindTooltip(`Marker represents ${agent.weight} simulated low-stress trips per weekday`)
        })
      }

      map.flyToBounds(L.latLngBounds(selectedPositions), { padding: [75, 75], maxZoom: 13, duration: 0.8 })
    }

    cyclingNetworkRef.current?.bringToBack()
    layerRef.current = group
    return () => { group.remove() }
  }, [activeIds, built, onSelect, opportunities, selected])

  return <div ref={containerRef} className="leaflet-map" aria-label={`OpenStreetMap of Toronto highlighting ${selected.name}`} />
}
