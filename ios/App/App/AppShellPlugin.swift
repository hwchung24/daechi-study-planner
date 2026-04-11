import Foundation
import Capacitor
import UIKit

@objc(AppShellPlugin)
public class AppShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppShellPlugin"
    public let jsName = "AppShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "switchToBundledAssets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "switchToRemoteIfAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingNetworkBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternalUrl", returnType: CAPPluginReturnPromise)
    ]

    @objc public func switchToBundledAssets(_ call: CAPPluginCall) {
        guard let viewController = bridge?.viewController as? AppBridgeViewController else {
            call.reject("App bridge view controller unavailable")
            return
        }

        let kind = call.getString("kind") ?? "offline"
        let message = call.getString("message") ?? ""

        DispatchQueue.main.async {
            viewController.switchToBundledAssets(kind: kind, message: message)
            call.resolve()
        }
    }

    @objc public func switchToRemoteIfAvailable(_ call: CAPPluginCall) {
        guard let viewController = bridge?.viewController as? AppBridgeViewController else {
            call.reject("App bridge view controller unavailable")
            return
        }

        let kind = call.getString("kind") ?? "online"
        let message = call.getString("message") ?? ""

        DispatchQueue.main.async {
            let switched = viewController.switchToRemoteIfAvailable(kind: kind, message: message)
            call.resolve(["switched": switched])
        }
    }

    @objc public func consumePendingNetworkBanner(_ call: CAPPluginCall) {
        guard let viewController = bridge?.viewController as? AppBridgeViewController else {
            call.resolve()
            return
        }

        call.resolve(viewController.consumePendingNetworkBanner() ?? [:])
    }

    @objc public func openExternalUrl(_ call: CAPPluginCall) {
        guard let rawUrl = call.getString("url"), let url = URL(string: rawUrl) else {
            call.reject("Valid url is required")
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                if success {
                    call.resolve()
                } else {
                    call.reject("Failed to open external url")
                }
            }
        }
    }
}