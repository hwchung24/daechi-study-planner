import Foundation
import Capacitor
import UIKit

@objc(NativeOfflineScreenTimePlugin)
public class NativeOfflineScreenTimePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeOfflineScreenTimePlugin"
    public let jsName = "NativeOfflineScreenTime"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    @objc public func getStatus(_ call: CAPPluginCall) {
        #if canImport(FamilyControls) && canImport(ManagedSettings)
        if #available(iOS 16.0, *) {
            DispatchQueue.main.async {
                call.resolve(OfflineScreenTimeCoordinator.shared.statusForBridge())
            }
            return
        }
        #endif
        call.resolve([
            "supported": false,
            "reason": "ios_16_or_family_controls_required"
        ])
    }
}
