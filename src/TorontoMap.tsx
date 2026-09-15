import { useEffect, useRef } from 'react'
import L, { type LayerGroup, type Map as LeafletMap } from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import 'leaflet/dist/leaflet.css'
import type { Corridor, CorridorSimulation } from './data/corridors.ts'
import { corridorGeometry } from './mapGeometry.ts'

type TorontoMapProps = {
  corridors: Corridor[]
  selected: Corridor
  activeIds: string[]
  built: boolean
  simulation: CorridorSimulation
  onSelect: (corridor: Corridor) => void
}

export function TorontoMap({ corridors, selected, activeIds, built, simulation, onSelect }: TorontoMapProps) {
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
    fetch('/data/toronto-cycling-network.geojson', { signal: controller.signal })
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
      .catch(() => { /* Preserve the base map when the local network snapshot is unavailable. */ })

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

    corridors.forEach((corridor) => {
      const positions = corridorGeometry[corridor.id]
      if (!positions) return
      const isSelected = corridor.id === selected.id
      const isActive = activeIds.includes(corridor.id)
      const routeClasses = [
        isSelected ? 'leaflet-selected-route' : null,
        built && isSelected ? 'leaflet-built-route' : null,
      ].filter(Boolean).join(' ')
      const line = L.polyline(positions, {
        color: isSelected ? '#7067e8' : '#8d8d92',
        weight: isSelected ? (built ? 7 : 5) : 3,
        opacity: isSelected ? 1 : isActive ? 0.72 : 0.3,
        className: routeClasses || undefined,
      }).addTo(group)
      line.bindTooltip(`<strong>${corridor.name}</strong><br>${corridor.subtitle}`, { className: 'velocity-tooltip' })
      line.on('click', () => onSelect(corridor))
    })

    const selectedGeometry = corridorGeometry[selected.id]
    if (selectedGeometry) {
      const first = selectedGeometry[0]
      const last = selectedGeometry[selectedGeometry.length - 1]
      L.circleMarker(first, { radius: 5, color: '#7067e8', fillColor: '#ffffff', fillOpacity: 1, weight: 2 }).addTo(group)
      L.circleMarker(last, { radius: 5, color: '#7067e8', fillColor: '#7067e8', fillOpacity: 1, weight: 2 }).addTo(group)
      if (built) {
        simulation.agents.slice(0, 8).forEach((agent, index) => {
          const position = selectedGeometry[index % selectedGeometry.length]
          L.circleMarker(position, {
            radius: 3.2,
            color: '#ffffff',
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 0,
            className: 'leaflet-agent',
          }).addTo(group).bindTooltip(`${agent.weight ?? 0} weighted trips/day`)
        })
      }
      map.flyToBounds(L.latLngBounds(selectedGeometry), { padding: [75, 75], maxZoom: 13, duration: 0.8 })
    }
    layerRef.current = group
    return () => { group.remove() }
  }, [activeIds, built, corridors, onSelect, selected, simulation.agents])

  return <div ref={containerRef} className="leaflet-map" aria-label={`OpenStreetMap of Toronto highlighting ${selected.name}`} />
}
