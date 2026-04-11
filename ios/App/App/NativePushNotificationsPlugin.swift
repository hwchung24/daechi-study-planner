import Foundation
import Capacitor
import UserNotifications
import UIKit

@objc final class NativePushNotificationsManager: NSObject {
    static let shared = NativePushNotificationsManager()

    private let deviceTokenKey = "daechi.push.deviceToken"
    private let lastErrorKey = "daechi.push.lastError"
    private var pendingRegisterCall: CAPPluginCall?

    func status() async -> [String: Any] {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let defaults = UserDefaults.standard
        return [
            "supported": true,
            "platform": "ios",
            "permissionStatus": permissionStatusString(settings.authorizationStatus),
            "registered": UIApplication.shared.isRegisteredForRemoteNotifications,
            "deviceToken": defaults.string(forKey: deviceTokenKey) as Any,
            "lastError": defaults.string(forKey: lastErrorKey) as Any
        ]
    }

    func requestPermissions(call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, error in
            if let error = error {
                UserDefaults.standard.set(error.localizedDescription, forKey: self.lastErrorKey)
            } else {
                UserDefaults.standard.removeObject(forKey: self.lastErrorKey)
            }
            Task { @MainActor in
                call.resolve(await self.status())
            }
        }
    }

    func register(call: CAPPluginCall) {
        pendingRegisterCall = call
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func didRegister(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        let defaults = UserDefaults.standard
        defaults.set(token, forKey: deviceTokenKey)
        defaults.removeObject(forKey: lastErrorKey)

        guard let call = pendingRegisterCall else { return }
        pendingRegisterCall = nil
        Task { @MainActor in
            call.resolve(await status())
        }
    }

    func didFailToRegister(error: Error) {
        UserDefaults.standard.set(error.localizedDescription, forKey: lastErrorKey)
        guard let call = pendingRegisterCall else { return }
        pendingRegisterCall = nil
        call.reject(error.localizedDescription)
    }

    private func permissionStatusString(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized:
            return "authorized"
        case .denied:
            return "denied"
        case .ephemeral:
            return "ephemeral"
        case .notDetermined:
            return "not_determined"
        case .provisional:
            return "provisional"
        @unknown default:
            return "unknown"
        }
    }
}

@objc(NativePushNotificationsPlugin)
public class NativePushNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePushNotificationsPlugin"
    public let jsName = "NativePushNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise)
    ]

    @objc public func getStatus(_ call: CAPPluginCall) {
        Task { @MainActor in
            call.resolve(await NativePushNotificationsManager.shared.status())
        }
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        NativePushNotificationsManager.shared.requestPermissions(call: call)
    }

    @objc public func register(_ call: CAPPluginCall) {
        NativePushNotificationsManager.shared.register(call: call)
    }
}