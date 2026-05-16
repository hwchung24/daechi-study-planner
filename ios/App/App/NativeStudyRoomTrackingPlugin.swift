import Foundation
import Capacitor
import CoreLocation

private struct StudyRoomTrackingConfig: Codable {
    let apiBase: String
    let authToken: String
}

@objc final class StudyRoomTrackingManager: NSObject, CLLocationManagerDelegate {
    static let shared = StudyRoomTrackingManager()
    private let heartbeatIntervalSeconds: TimeInterval = 45
    private let minimumDistanceDeltaMeters: CLLocationDistance = 25

    private let locationManager = CLLocationManager()
    private let configKey = "daechi.studyRoomTracking.config"
    private let enabledKey = "daechi.studyRoomTracking.enabled"
    private let lastHeartbeatAtKey = "daechi.studyRoomTracking.lastHeartbeatAt"
    private let lastErrorKey = "daechi.studyRoomTracking.lastError"
    private var pendingPermissionCall: CAPPluginCall?
    private var pendingLocationRefreshCompletion: (() -> Void)?
    private var forceNextHeartbeat = false
    private var lastSentAt: Date?
    private var lastSentLocation: CLLocation?

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = 50
        locationManager.pausesLocationUpdatesAutomatically = true
        locationManager.allowsBackgroundLocationUpdates = true
    }

    func status() -> [String: Any] {
        let defaults = UserDefaults.standard
        return [
            "supported": CLLocationManager.locationServicesEnabled(),
            "platform": "ios",
            "authorizationStatus": authorizationStatusString(),
            "trackingEnabled": defaults.bool(forKey: enabledKey),
            "hasConfig": loadConfig() != nil,
            "lastHeartbeatAt": defaults.string(forKey: lastHeartbeatAtKey) as Any,
            "lastError": defaults.string(forKey: lastErrorKey) as Any
        ]
    }

    func requestPermissions(call: CAPPluginCall) {
        let status = currentAuthorizationStatus()
        if status == .authorizedAlways || status == .authorizedWhenInUse || status == .denied || status == .restricted {
            call.resolve(self.status())
            return
        }

        pendingPermissionCall = call
        DispatchQueue.main.async {
            self.locationManager.requestAlwaysAuthorization()
        }
    }

    func startTracking(apiBase: String, authToken: String, call: CAPPluginCall) {
        let authStatus = currentAuthorizationStatus()
        if authStatus != .authorizedAlways && authStatus != .authorizedWhenInUse {
            call.reject("location_permission_required")
            return
        }

        let config = StudyRoomTrackingConfig(apiBase: apiBase, authToken: authToken)
        saveConfig(config)
        UserDefaults.standard.set(true, forKey: enabledKey)
        UserDefaults.standard.removeObject(forKey: lastErrorKey)
        DispatchQueue.main.async {
            self.locationManager.startUpdatingLocation()
            if self.currentAuthorizationStatus() == .authorizedAlways {
                self.locationManager.startMonitoringSignificantLocationChanges()
            }
        }
        call.resolve(status())
    }

    func stopTracking(clearConfig: Bool) -> [String: Any] {
        DispatchQueue.main.async {
            self.locationManager.stopUpdatingLocation()
            self.locationManager.stopMonitoringSignificantLocationChanges()
        }
        let defaults = UserDefaults.standard
        defaults.set(false, forKey: enabledKey)
        if clearConfig {
            defaults.removeObject(forKey: configKey)
        }
        return status()
    }

    func reportLocationNow(completion: (() -> Void)? = nil) {
        guard UserDefaults.standard.bool(forKey: enabledKey), loadConfig() != nil else {
            completion?()
            return
        }

        let authStatus = currentAuthorizationStatus()
        guard authStatus == .authorizedAlways || authStatus == .authorizedWhenInUse else {
            completion?()
            return
        }

        pendingLocationRefreshCompletion = completion
        forceNextHeartbeat = true
        DispatchQueue.main.async {
            self.locationManager.requestLocation()
            self.locationManager.startUpdatingLocation()
        }
    }

    func resumeIfNeeded() {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: enabledKey), loadConfig() != nil else {
            return
        }

        let authStatus = currentAuthorizationStatus()
        guard authStatus == .authorizedAlways || authStatus == .authorizedWhenInUse else {
            return
        }

        DispatchQueue.main.async {
            self.locationManager.startUpdatingLocation()
            if self.currentAuthorizationStatus() == .authorizedAlways {
                self.locationManager.startMonitoringSignificantLocationChanges()
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard let call = pendingPermissionCall else {
            return
        }
        let authStatus = currentAuthorizationStatus(manager)
        if authStatus == .notDetermined {
            return
        }
        pendingPermissionCall = nil
        call.resolve(status())
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        UserDefaults.standard.set(error.localizedDescription, forKey: lastErrorKey)
        if let completion = pendingLocationRefreshCompletion {
            pendingLocationRefreshCompletion = nil
            completion()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard UserDefaults.standard.bool(forKey: enabledKey) else {
            return
        }
        guard let config = loadConfig(), let location = locations.last else {
            return
        }
        let now = Date()
        let forceSend = forceNextHeartbeat
        let intervalOk =
            forceSend
            || lastSentAt == nil
            || now.timeIntervalSince(lastSentAt!) >= heartbeatIntervalSeconds
        let movedOk =
            forceSend
            || lastSentLocation == nil
            || location.distance(from: lastSentLocation!) >= minimumDistanceDeltaMeters
        if !intervalOk && !movedOk {
            return
        }
        forceNextHeartbeat = false
        lastSentAt = now
        lastSentLocation = location
        sendHeartbeat(location: location, config: config)
        if let completion = pendingLocationRefreshCompletion {
            pendingLocationRefreshCompletion = nil
            completion()
        }
    }

    private func authorizationStatusString() -> String {
        switch currentAuthorizationStatus() {
        case .authorizedAlways:
            return "authorized_always"
        case .authorizedWhenInUse:
            return "authorized_when_in_use"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            return "not_determined"
        @unknown default:
            return "unknown"
        }
    }

    private func currentAuthorizationStatus(_ manager: CLLocationManager? = nil) -> CLAuthorizationStatus {
        if #available(iOS 14.0, *) {
            return (manager ?? locationManager).authorizationStatus
        }
        return CLLocationManager.authorizationStatus()
    }

    private func loadConfig() -> StudyRoomTrackingConfig? {
        guard let raw = UserDefaults.standard.string(forKey: configKey),
              let data = raw.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(StudyRoomTrackingConfig.self, from: data)
    }

    private func saveConfig(_ config: StudyRoomTrackingConfig) {
        guard let data = try? JSONEncoder().encode(config),
              let raw = String(data: data, encoding: .utf8) else {
            return
        }
        UserDefaults.standard.set(raw, forKey: configKey)
    }

    private func sendHeartbeat(location: CLLocation, config: StudyRoomTrackingConfig) {
        let base = config.apiBase.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard let url = URL(string: "\(base)/api/student/location/heartbeat") else {
            UserDefaults.standard.set("invalid_api_base", forKey: lastErrorKey)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.authToken)", forHTTPHeaderField: "Authorization")

        let formatter = ISO8601DateFormatter()
        let payload: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "accuracy": location.horizontalAccuracy,
            "timestamp": formatter.string(from: Date())
        ]

        guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
            UserDefaults.standard.set("payload_encode_failed", forKey: lastErrorKey)
            return
        }

        request.httpBody = body

        URLSession.shared.dataTask(with: request) { _, response, error in
            let defaults = UserDefaults.standard
            if let error = error {
                defaults.set(error.localizedDescription, forKey: self.lastErrorKey)
                return
            }
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                defaults.set("heartbeat_\(http.statusCode)", forKey: self.lastErrorKey)
                return
            }
            defaults.removeObject(forKey: self.lastErrorKey)
            defaults.set(formatter.string(from: Date()), forKey: self.lastHeartbeatAtKey)
        }.resume()
    }
}

@objc(NativeStudyRoomTrackingPlugin)
public class NativeStudyRoomTrackingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeStudyRoomTrackingPlugin"
    public let jsName = "NativeStudyRoomTracking"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportLocationNow", returnType: CAPPluginReturnPromise)
    ]

    @objc public func getStatus(_ call: CAPPluginCall) {
        call.resolve(StudyRoomTrackingManager.shared.status())
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        StudyRoomTrackingManager.shared.requestPermissions(call: call)
    }

    @objc public func startTracking(_ call: CAPPluginCall) {
        let apiBase = call.getString("apiBase") ?? ""
        let authToken = call.getString("authToken") ?? ""
        if apiBase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || authToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            call.reject("api_base_and_auth_token_required")
            return
        }
        StudyRoomTrackingManager.shared.startTracking(apiBase: apiBase, authToken: authToken, call: call)
    }

    @objc public func stopTracking(_ call: CAPPluginCall) {
        let clearConfig = call.getBool("clearConfig") ?? false
        call.resolve(StudyRoomTrackingManager.shared.stopTracking(clearConfig: clearConfig))
    }

    @objc public func reportLocationNow(_ call: CAPPluginCall) {
        StudyRoomTrackingManager.shared.reportLocationNow {
            call.resolve(StudyRoomTrackingManager.shared.status())
        }
    }
}