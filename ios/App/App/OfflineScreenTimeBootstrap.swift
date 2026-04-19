import Foundation

/// `AppDelegate` 등에서 항상 참조 가능하도록 Family Controls 연동 진입점만 둡니다.
enum OfflineScreenTimeBootstrap {
    static func start() {
        #if canImport(FamilyControls) && canImport(ManagedSettings)
        if #available(iOS 16.0, *) {
            Task { @MainActor in
                OfflineScreenTimeCoordinator.shared.start()
            }
        }
        #endif
    }
}
