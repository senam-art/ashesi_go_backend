import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter_polyline_points/flutter_polyline_points.dart';
import 'package:driver_app/config.dart';

const double CAMERA_ZOOM = 13;
const double CAMERA_TILT = 0;
const double CAMERA_BEARING = 30;
const LatLng SOURCE_LOCATION = LatLng(42.7477863, -71.1699932);
const LatLng DEST_LOCATION = LatLng(42.6871386, -71.2143403);

class LiveMapComponent extends StatefulWidget {
  final String journeyId;

  const LiveMapComponent({super.key, required this.journeyId});

  @override
  State<LiveMapComponent> createState() => _LiveMapComponentState();
}

class _LiveMapComponentState extends State<LiveMapComponent> {
  final Completer<GoogleMapController> _controller = Completer();

  // 1. Corrected initialization (List uses [], Set uses {})
  final Set<Marker> _markers = {};
  final Set<Polyline> _polylines = {};
  final List<LatLng> _polylineCoordinates = [];

  final PolylinePoints polylinePoints = PolylinePoints(apiKey: AppConfig.googleMapsApiKey);

  // Nullable because they won't exist for the first millisecond of the app
  BitmapDescriptor? sourceIcon;
  BitmapDescriptor? destinationIcon;

  @override
  void initState() {
    super.initState();
    _initMapData();
  }

  // 2. Modern way to load icons (BitmapDescriptor.asset)
  Future<void> _initMapData() async {
    sourceIcon = await BitmapDescriptor.asset(
      const ImageConfiguration(devicePixelRatio: 2.5),
      'assets/bus_marker_blue.png',
    );

    destinationIcon = await BitmapDescriptor.asset(
      const ImageConfiguration(devicePixelRatio: 2.5),
      'assets/end_point_marker.png',
    );

    // Refresh UI once icons are loaded
    if (mounted) setState(() => _setMapPins());
  }

  // 3. Modern Polyline Request
  Future<void> setPolylines() async {
    try {
      // 1. We use getRouteBetweenCoordinates because your package doesn't have the new method yet
      // 2. We use PolylineRequest because the method specifically asks for it
      PolylineResult result = await polylinePoints.getRouteBetweenCoordinates(
        request: PolylineRequest(
          origin: PointLatLng(SOURCE_LOCATION.latitude, SOURCE_LOCATION.longitude),
          destination: PointLatLng(DEST_LOCATION.latitude, DEST_LOCATION.longitude),
          mode: TravelMode.driving,
        ),
      );

      if (result.points.isNotEmpty) {
        _polylineCoordinates.clear();
        for (var point in result.points) {
          _polylineCoordinates.add(LatLng(point.latitude, point.longitude));
        }

        setState(() {
          _polylines.add(
            Polyline(
              polylineId: const PolylineId("poly"),
              color: const Color.fromARGB(255, 40, 122, 198),
              width: 5,
              points: List.from(_polylineCoordinates),
            ),
          );
        });
      }
    } catch (e) {
      debugPrint("Error: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    return GoogleMap(
      initialCameraPosition: const CameraPosition(target: SOURCE_LOCATION, zoom: CAMERA_ZOOM),
      markers: _markers,
      polylines: _polylines,
      style: _mapStyle, // 4. Apply style directly here (Newer approach)
      onMapCreated: (GoogleMapController controller) {
        _controller.complete(controller);
        _setPolylines(); // Draw the line once map is ready
      },
    );
  }
}

// void setCustomMapPin() async {
//   pinLocationIcon = await BitmapDescriptor.asset(
//     ImageConfiguration(devicePixelRatio: 2.5),
//     'assets/bus_marker_maroon1.png',
//   );
// }

// CRITICAL: Handle when the parent changes the journeyId (e.g., swiping the carousel)
// @override
// void didUpdateWidget(LiveMapComponent oldWidget) {
//   super.didUpdateWidget(oldWidget);
//   if (widget.journeyId != oldWidget.journeyId) {
//     _unsubscribe();
//     _subscribeToLiveLocation();
//   }
// }

void _unsubscribe() {
  if (_channel != null) {
    Supabase.instance.client.removeChannel(_channel!);
    _channel = null;
  }
}

// void _subscribeToLiveLocation() {
//   _channel = Supabase.instance.client.channel('journey_${widget.journeyId}');

//   _channel!
//       .onBroadcast(
//         event: 'location_update',
//         callback: (payload) {
//           final innerData = payload['payload'] ?? {};
//           final double lat = _parseNum(innerData['lat']);
//           final double lng = _parseNum(innerData['lng']);
//           final double heading = _parseNum(innerData['heading']);

//           _updateBusMarker(LatLng(lat, lng), heading);
//         },
//       )
//       .subscribe();
// }

double _parseNum(dynamic val) {
  if (val is num) return val.toDouble();
  return double.tryParse(val?.toString() ?? '0.0') ?? 0.0;
}

// void _updateBusMarker(LatLng targetPosition, double rotation) {
//   if (!mounted) return;
//   setState(() {
//     _lastPosition = targetPosition;
//     _busMarker = Marker(
//       markerId: const MarkerId('live_bus'),
//       position: targetPosition,
//       rotation: rotation, // Now the bus points the right way!
//       anchor: const Offset(0.5, 0.5),
//       icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
//     );
//   });
// }

@override
void dispose() {
  _unsubscribe(); // Clean up connections
  super.dispose();
}

// void centerMapOnBus() {
//   _mapController?.animateCamera(CameraUpdate.newLatLng(_lastPosition));
// }

// Simplified map style to reduce OpenGL memory load on Android devices
final String _mapStyle = '''
  [
    {
      "featureType": "poi",
      "stylers": [
        { "visibility": "off" }
      ]
    },
    {
      "featureType": "transit",
      "stylers": [
        { "visibility": "off" }
      ]
    },
    {
      "featureType": "landscape.man_made",
      "elementType": "geometry.fill",
      "stylers": [
        { "visibility": "off" }
      ]
    }
  ]
  ''';

//   @override
//   Widget build(BuildContext context) {
//     // Removed Scaffold because this is now a Component to be used in a Stack
//     return GoogleMap(
//       myLocationEnabled: true,
//       markers: _markers
//       initialCameraPosition: initialLocation,
//       style: _mapStyle, // Apply performance-focused style
//       onMapCreated: (controller) {
//         _mapController = controller;

//         //Passing controller back up to parent
//         if (widget.onControllerCreated != null) {
//           widget.onControllerCreated!(controller);
//         }
//       },
//       myLocationButtonEnabled: false,
//       zoomControlsEnabled: false, // Cleaner look for your modular design
//     );
//   }
// }
