import Foundation
import UIKit
import Capacitor

@objc(NativeKeyboardInputPlugin)
public class NativeKeyboardInputPlugin: CAPPlugin, CAPBridgedPlugin, UITextFieldDelegate, UITextViewDelegate {
    public let identifier = "NativeKeyboardInputPlugin"
    public let jsName = "NativeKeyboardInput"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncValue", returnType: CAPPluginReturnPromise)
    ]

    private weak var overlayView: UIView?
    private weak var backdropButton: UIButton?
    private weak var dockView: UIView?
    private weak var textField: UITextField?
    private weak var textView: UITextView?
    private weak var textViewPlaceholderLabel: UILabel?
    private var bottomConstraint: NSLayoutConstraint?
    private var activeMultiline = false
    private var submitOnReturn = true
    private var maxLength: Int?
    private var isClosing = false
    private var keyboardObservers: [NSObjectProtocol] = []

    public override func load() {
        super.load()
        registerKeyboardObservers()
    }

    deinit {
        for observer in keyboardObservers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    @objc public func show(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.presentInput(call: call)
        }
    }

    @objc public func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.dismissOverlay(notify: true)
            call.resolve()
        }
    }

    @objc public func syncValue(_ call: CAPPluginCall) {
        let value = call.getString("value") ?? ""

        DispatchQueue.main.async {
            if self.activeMultiline {
                self.textView?.text = value
                self.updateTextViewPlaceholderVisibility()
            } else {
                self.textField?.text = value
            }
            call.resolve()
        }
    }

    private func presentInput(call: CAPPluginCall) {
        guard let hostView = bridge?.viewController?.view else {
            call.reject("Host view unavailable")
            return
        }

        activeMultiline = call.getBool("multiline") ?? false
        submitOnReturn = !(call.getBool("multiline") ?? false)
        maxLength = call.getInt("maxLength")

        let value = call.getString("value") ?? ""
        let placeholder = call.getString("placeholder") ?? ""
        let label = call.getString("label") ?? placeholder
        let inputType = (call.getString("inputType") ?? "text").lowercased()
        let inputMode = (call.getString("inputMode") ?? "").lowercased()
        let enterKeyHint = (call.getString("enterKeyHint") ?? "").lowercased()
        let autoCapitalize = (call.getString("autoCapitalize") ?? "sentences").lowercased()
        let autoCorrect = (call.getString("autoCorrect") ?? "default").lowercased()
        let spellCheck = call.getBool("spellCheck") ?? true

        ensureOverlay(in: hostView)
        configureDock(multiline: activeMultiline)

        backdropButton?.accessibilityLabel = "입력 닫기"

        if activeMultiline {
            guard let activeTextView = textView else {
                call.reject("Native text view unavailable")
                return
            }
            activeTextView.text = value
            activeTextView.accessibilityLabel = label
            activeTextView.autocapitalizationType = autocapitalizationType(for: autoCapitalize)
            activeTextView.autocorrectionType = autocorrectionType(for: autoCorrect)
            activeTextView.spellCheckingType = spellCheck ? .yes : .no
            textViewPlaceholderLabel?.text = placeholder
            updateTextViewPlaceholderVisibility()
            activeTextView.becomeFirstResponder()
        } else {
            guard let activeTextField = textField else {
                call.reject("Native text field unavailable")
                return
            }
            activeTextField.text = value
            activeTextField.placeholder = placeholder
            activeTextField.accessibilityLabel = label
            activeTextField.keyboardType = keyboardType(for: inputType, inputMode: inputMode)
            activeTextField.returnKeyType = returnKeyType(for: enterKeyHint, inputType: inputType)
            activeTextField.autocapitalizationType = autocapitalizationType(for: autoCapitalize)
            activeTextField.autocorrectionType = autocorrectionType(for: autoCorrect)
            activeTextField.spellCheckingType = spellCheck ? .yes : .no
            activeTextField.isSecureTextEntry = inputType == "password"
            activeTextField.becomeFirstResponder()
        }

        call.resolve()
    }

    private func ensureOverlay(in hostView: UIView) {
        if let overlayView, overlayView.superview != nil {
            return
        }

        let overlay = UIView(frame: hostView.bounds)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.backgroundColor = .clear

        let backdrop = UIButton(type: .custom)
        backdrop.translatesAutoresizingMaskIntoConstraints = false
        backdrop.backgroundColor = .clear
        backdrop.addTarget(self, action: #selector(handleBackdropTap), for: .touchUpInside)

        let dock = UIView()
        dock.translatesAutoresizingMaskIntoConstraints = false
        dock.backgroundColor = UIColor(white: 1, alpha: 0.98)
        dock.layer.cornerRadius = 18
        dock.layer.cornerCurve = .continuous
        dock.layer.borderWidth = 1
        dock.layer.borderColor = UIColor(red: 36.0 / 255.0, green: 59.0 / 255.0, blue: 107.0 / 255.0, alpha: 0.18).cgColor
        dock.layer.shadowColor = UIColor.black.cgColor
        dock.layer.shadowOpacity = 0.1
        dock.layer.shadowRadius = 18
        dock.layer.shadowOffset = CGSize(width: 0, height: 8)

        overlay.addSubview(backdrop)
        overlay.addSubview(dock)
        hostView.addSubview(overlay)

        let bottomConstraint = dock.bottomAnchor.constraint(equalTo: hostView.bottomAnchor, constant: -10)
        self.bottomConstraint = bottomConstraint

        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: hostView.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: hostView.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: hostView.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: hostView.bottomAnchor),

            backdrop.leadingAnchor.constraint(equalTo: overlay.leadingAnchor),
            backdrop.trailingAnchor.constraint(equalTo: overlay.trailingAnchor),
            backdrop.topAnchor.constraint(equalTo: overlay.topAnchor),
            backdrop.bottomAnchor.constraint(equalTo: overlay.bottomAnchor),

            dock.leadingAnchor.constraint(equalTo: hostView.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            dock.trailingAnchor.constraint(equalTo: hostView.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            bottomConstraint
        ])

        self.overlayView = overlay
        self.backdropButton = backdrop
        self.dockView = dock
    }

    private func configureDock(multiline: Bool) {
        guard let dockView else { return }

        dockView.subviews.forEach { $0.removeFromSuperview() }

        if multiline {
            let input = UITextView()
            input.translatesAutoresizingMaskIntoConstraints = false
            input.delegate = self
            input.backgroundColor = .clear
            input.font = UIFont.systemFont(ofSize: 16)
            input.textColor = UIColor.black
            input.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
            input.isScrollEnabled = true

            let placeholder = UILabel()
            placeholder.translatesAutoresizingMaskIntoConstraints = false
            placeholder.font = UIFont.systemFont(ofSize: 16)
            placeholder.textColor = UIColor(red: 0, green: 0, blue: 0, alpha: 0.42)
            placeholder.numberOfLines = 0

            dockView.addSubview(input)
            dockView.addSubview(placeholder)

            NSLayoutConstraint.activate([
                dockView.heightAnchor.constraint(greaterThanOrEqualToConstant: 118),
                dockView.heightAnchor.constraint(lessThanOrEqualToConstant: 220),
                input.leadingAnchor.constraint(equalTo: dockView.leadingAnchor),
                input.trailingAnchor.constraint(equalTo: dockView.trailingAnchor),
                input.topAnchor.constraint(equalTo: dockView.topAnchor),
                input.bottomAnchor.constraint(equalTo: dockView.bottomAnchor),
                placeholder.leadingAnchor.constraint(equalTo: dockView.leadingAnchor, constant: 16),
                placeholder.trailingAnchor.constraint(equalTo: dockView.trailingAnchor, constant: -16),
                placeholder.topAnchor.constraint(equalTo: dockView.topAnchor, constant: 12)
            ])

            textField = nil
            textView = input
            textViewPlaceholderLabel = placeholder
            return
        }

        let input = UITextField()
        input.translatesAutoresizingMaskIntoConstraints = false
        input.delegate = self
        input.font = UIFont.systemFont(ofSize: 16)
        input.textColor = UIColor.black
        input.borderStyle = .none
        input.clearButtonMode = .never

        dockView.addSubview(input)

        NSLayoutConstraint.activate([
            dockView.heightAnchor.constraint(equalToConstant: 54),
            input.leadingAnchor.constraint(equalTo: dockView.leadingAnchor, constant: 16),
            input.trailingAnchor.constraint(equalTo: dockView.trailingAnchor, constant: -16),
            input.topAnchor.constraint(equalTo: dockView.topAnchor),
            input.bottomAnchor.constraint(equalTo: dockView.bottomAnchor)
        ])

        textField = input
        textView = nil
        textViewPlaceholderLabel = nil
    }

    private func registerKeyboardObservers() {
        let center = NotificationCenter.default
        let names: [NSNotification.Name] = [
            UIResponder.keyboardWillChangeFrameNotification,
            UIResponder.keyboardWillHideNotification
        ]

        keyboardObservers = names.map { name in
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                self?.handleKeyboardFrame(note)
            }
        }
    }

    private func handleKeyboardFrame(_ notification: Notification) {
        guard let hostView = bridge?.viewController?.view,
              let dockView,
              let bottomConstraint,
              let info = notification.userInfo,
              let keyboardFrameValue = info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue else {
            return
        }

        let keyboardFrame = hostView.convert(keyboardFrameValue.cgRectValue, from: nil)
        let overlap = max(0, hostView.bounds.maxY - keyboardFrame.minY)
        bottomConstraint.constant = -(overlap + 10)

        let duration = (info[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
        let curveRaw = (info[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber)?.uintValue ?? 7
        let options = UIView.AnimationOptions(rawValue: curveRaw << 16)

        UIView.animate(withDuration: duration, delay: 0, options: options) {
            hostView.layoutIfNeeded()
            dockView.alpha = overlap > 0 || self.currentValue().isEmpty == false ? 1 : 1
        }
    }

    @objc private func handleBackdropTap() {
        dismissOverlay(notify: true)
    }

    private func dismissOverlay(notify: Bool) {
        guard overlayView != nil else { return }

        let finalValue = currentValue()
        isClosing = true
        textField?.resignFirstResponder()
        textView?.resignFirstResponder()
        overlayView?.removeFromSuperview()
        overlayView = nil
        backdropButton = nil
        dockView = nil
        textField = nil
        textView = nil
        textViewPlaceholderLabel = nil
        bottomConstraint = nil

        if notify {
            notifyListeners("dismiss", data: ["value": finalValue])
        }

        DispatchQueue.main.async {
            self.isClosing = false
        }
    }

    private func currentValue() -> String {
        if activeMultiline {
            return textView?.text ?? ""
        }

        return textField?.text ?? ""
    }

    private func keyboardType(for inputType: String, inputMode: String) -> UIKeyboardType {
        if inputType == "email" || inputMode == "email" {
            return .emailAddress
        }
        if inputType == "tel" || inputMode == "tel" {
            return .phonePad
        }
        if inputType == "url" || inputMode == "url" {
            return .URL
        }
        if inputType == "number" || inputMode == "numeric" || inputMode == "decimal" {
            return .numberPad
        }
        return .default
    }

    private func returnKeyType(for enterKeyHint: String, inputType: String) -> UIReturnKeyType {
        switch enterKeyHint {
        case "search":
            return .search
        case "send":
            return .send
        case "go":
            return .go
        case "next":
            return .next
        case "done":
            return .done
        default:
            if inputType == "search" {
                return .search
            }
            return .done
        }
    }

    private func autocapitalizationType(for value: String) -> UITextAutocapitalizationType {
        switch value {
        case "none":
            return .none
        case "words":
            return .words
        case "characters":
            return .allCharacters
        default:
            return .sentences
        }
    }

    private func autocorrectionType(for value: String) -> UITextAutocorrectionType {
        switch value {
        case "off", "false", "no":
            return .no
        case "on", "true", "yes":
            return .yes
        default:
            return .default
        }
    }

    private func updateTextViewPlaceholderVisibility() {
        textViewPlaceholderLabel?.isHidden = !(textView?.text ?? "").isEmpty == true
    }

    public func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        if let maxLength,
           let current = textField.text,
           let swiftRange = Range(range, in: current) {
            let updated = current.replacingCharacters(in: swiftRange, with: string)
            return updated.count <= maxLength
        }
        return true
    }

    @objc private func textFieldEditingChanged(_ sender: UITextField) {
        notifyListeners("textChange", data: ["value": sender.text ?? ""])
    }

    public func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        let value = textField.text ?? ""
        notifyListeners("submit", data: ["value": value])
        if submitOnReturn {
            dismissOverlay(notify: true)
        }
        return false
    }

    public func textFieldDidBeginEditing(_ textField: UITextField) {
        textField.removeTarget(self, action: #selector(textFieldEditingChanged(_:)), for: .editingChanged)
        textField.addTarget(self, action: #selector(textFieldEditingChanged(_:)), for: .editingChanged)
    }

    public func textFieldDidEndEditing(_ textField: UITextField) {
        if !isClosing {
            dismissOverlay(notify: true)
        }
    }

    public func textViewDidChange(_ textView: UITextView) {
        updateTextViewPlaceholderVisibility()
        notifyListeners("textChange", data: ["value": textView.text ?? ""])
    }

    public func textViewDidEndEditing(_ textView: UITextView) {
        if !isClosing {
            dismissOverlay(notify: true)
        }
    }

    public func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        if let maxLength,
           let current = textView.text,
           let swiftRange = Range(range, in: current) {
            let updated = current.replacingCharacters(in: swiftRange, with: text)
            if updated.count > maxLength {
                return false
            }
        }

        if submitOnReturn && text == "\n" {
            let value = textView.text ?? ""
            notifyListeners("submit", data: ["value": value])
            dismissOverlay(notify: true)
            return false
        }

        return true
    }
}