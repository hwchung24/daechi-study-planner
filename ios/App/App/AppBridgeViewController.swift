import Foundation
import Capacitor

@objc(AppBridgeViewController)
class AppBridgeViewController: CAPBridgeViewController {
    private let remoteWebUrlKey = "DaechiRemoteWebUrl"
    private let lastRemoteFailureKey = "daechi.remoteWeb.lastFailureAt"
    private let pendingBannerKindKey = "daechi.networkBanner.kind"
    private let pendingBannerMessageKey = "daechi.networkBanner.message"
    private let remoteProbeTimeout: TimeInterval = 1.2

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(AppShellPlugin())
    }

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()

        guard let remoteURL = configuredRemoteURL() else {
            CAPLog.print("⚡️  Remote web disabled; using bundled app.")
            return descriptor
        }

        if probeRemoteURL(remoteURL) {
            descriptor.serverURL = remoteURL.absoluteString
            clearRecentRemoteFailure()
            CAPLog.print("⚡️  Remote web available; loading \(remoteURL.absoluteString)")
        } else {
            rememberRemoteFailure()
            CAPLog.print("⚡️  Remote web unavailable; falling back to bundled app.")
        }

        return descriptor
    }

    private func configuredRemoteURL() -> URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: remoteWebUrlKey) as? String else {
            return nil
        }

        let trimmedValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedValue.isEmpty else {
            return nil
        }

        return URL(string: trimmedValue)
    }

    private func rememberRemoteFailure() {
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastRemoteFailureKey)
    }

    private func clearRecentRemoteFailure() {
        UserDefaults.standard.removeObject(forKey: lastRemoteFailureKey)
    }

    func switchToBundledAssets(kind: String, message: String) {
        rememberRemoteFailure()
        setPendingNetworkBanner(kind: kind, message: message)
        let bundledPath = Bundle.main.url(forResource: "public", withExtension: nil)?.path ?? "public"
        setServerBasePath(path: bundledPath)
    }

    func switchToRemoteIfAvailable(kind: String, message: String) -> Bool {
        guard let remoteURL = configuredRemoteURL(), probeRemoteURL(remoteURL) else {
            rememberRemoteFailure()
            return false
        }

        clearRecentRemoteFailure()
        setPendingNetworkBanner(kind: kind, message: message)
        webView?.load(URLRequest(url: remoteURL))
        return true
    }

    func consumePendingNetworkBanner() -> [String: Any]? {
        let defaults = UserDefaults.standard
        let kind = String(defaults.string(forKey: pendingBannerKindKey) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let message = String(defaults.string(forKey: pendingBannerMessageKey) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        defaults.removeObject(forKey: pendingBannerKindKey)
        defaults.removeObject(forKey: pendingBannerMessageKey)

        guard !kind.isEmpty || !message.isEmpty else {
            return nil
        }

        return [
            "kind": kind,
            "message": message
        ]
    }

    private func setPendingNetworkBanner(kind: String, message: String) {
        let defaults = UserDefaults.standard
        defaults.set(kind, forKey: pendingBannerKindKey)
        defaults.set(message, forKey: pendingBannerMessageKey)
    }

    private func probeRemoteURL(_ remoteURL: URL) -> Bool {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.timeoutIntervalForRequest = remoteProbeTimeout
        sessionConfig.timeoutIntervalForResource = remoteProbeTimeout
        sessionConfig.waitsForConnectivity = false
        sessionConfig.requestCachePolicy = .reloadIgnoringLocalCacheData

        let session = URLSession(configuration: sessionConfig)
        var request = URLRequest(url: remoteURL)
        request.timeoutInterval = remoteProbeTimeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let semaphore = DispatchSemaphore(value: 0)
        var isReachable = false

        let task = session.dataTask(with: request) { _, response, error in
            defer { semaphore.signal() }

            if let error {
                CAPLog.print("⚡️  Remote web probe failed: \(error.localizedDescription)")
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                return
            }

            isReachable = (200...399).contains(httpResponse.statusCode)
        }

        task.resume()

        if semaphore.wait(timeout: .now() + remoteProbeTimeout) == .timedOut {
            task.cancel()
            session.invalidateAndCancel()
            CAPLog.print("⚡️  Remote web probe timed out.")
            return false
        }

        session.finishTasksAndInvalidate()
        return isReachable
    }
}