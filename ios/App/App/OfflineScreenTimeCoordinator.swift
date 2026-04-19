import Foundation
import Network
import Capacitor

#if canImport(FamilyControls) && canImport(ManagedSettings)
import FamilyControls
import ManagedSettings

/// 오프라인(네트워크 경로 `unsatisfied`)일 때 다른 앱을 가리고, **이 앱(대치루트)만** 쓰도록 고정합니다.
///
/// Apple 문서: `ShieldSettings.applicationCategories`에 대해 **호스트 앱은 `.all` 정책에서 자동으로 제외**됩니다.
/// 따라서 예외 토큰 없이 `.all(except: [])`만 설정합니다. 전화·메시지·설정 등은 차단 대상이 됩니다.
///
/// - 앱 내 `WKWebView`·원격 웹 URL은 ManagedSettings와 별개이며, Safari 등 **다른 앱**은 오프라인 시 가려집니다.
/// - 앱이 백그라운드·종료이면 `NWPathMonitor`가 동작하지 않아 전환을 놓칠 수 있습니다.
@available(iOS 16.0, *)
@MainActor
final class OfflineScreenTimeCoordinator {
    static let shared = OfflineScreenTimeCoordinator()

    private let settingsStore = ManagedSettingsStore()
    private var pathMonitor: NWPathMonitor?
    private let pathQueue = DispatchQueue(label: "daechi.offlineScreenTime.nwpath")
    private var lastPathSatisfied: Bool?

    private init() {}

    func start() {
        startPathMonitorIfNeeded()
        Task { await runStartupFlow() }
    }

    private func startPathMonitorIfNeeded() {
        guard pathMonitor == nil else { return }
        let monitor = NWPathMonitor()
        pathMonitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = (path.status == .satisfied)
            Task { @MainActor in
                self?.handlePathSatisfiedChanged(satisfied)
            }
        }
        monitor.start(queue: pathQueue)
    }

    private func handlePathSatisfiedChanged(_ satisfied: Bool) {
        if lastPathSatisfied == satisfied { return }
        lastPathSatisfied = satisfied

        if satisfied {
            clearOfflineRestrictions()
        } else {
            applyOfflineRestrictionsIfPossible()
        }
    }

    private func runStartupFlow() async {
        await requestAuthorizationIfNeeded()
    }

    private func requestAuthorizationIfNeeded() async {
        let center = AuthorizationCenter.shared
        switch center.authorizationStatus {
        case .approved, .denied:
            return
        case .notDetermined:
            do {
                try await center.requestAuthorization(for: .individual)
            } catch {
                CAPLog.print("⚡️  Family Controls authorization failed: \(error.localizedDescription)")
            }
        @unknown default:
            return
        }
    }

    func statusForBridge() -> [String: Any] {
        let auth = AuthorizationCenter.shared.authorizationStatus
        return [
            "supported": true,
            "authorization": authorizationStatusString(auth),
            "offlineLockMode": "daechi_app_only",
            "pathSatisfied": lastPathSatisfied as Any
        ]
    }

    private func authorizationStatusString(_ status: AuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "not_determined"
        case .denied: return "denied"
        case .approved: return "approved"
        @unknown default: return "unknown"
        }
    }

    private func applyOfflineRestrictionsIfPossible() {
        guard AuthorizationCenter.shared.authorizationStatus == .approved else { return }

        settingsStore.clearAllSettings()
        settingsStore.shield.applicationCategories = .all(except: [])
    }

    private func clearOfflineRestrictions() {
        settingsStore.clearAllSettings()
    }
}

#endif
