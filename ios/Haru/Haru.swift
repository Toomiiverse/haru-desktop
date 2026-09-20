// A client for the door she already answers on.
//
// Deliberately not a second Haru: no history of its own, no memory, no mood.
// Everything lives on the desktop that runs her, exactly as scripts/haru.cjs
// decided, and this asks the same web server the phone's browser asks.
//
// The token is carried by hand rather than by URLSession's cookie store. Her
// cookies are Secure, so the store would refuse to send them back over a plain
// http:// LAN address and every call after a successful sign-in would 401 with
// nothing to show for it. A header we set ourselves has no such opinion.

import AVFoundation
import Foundation
import UIKit

struct Fail: LocalizedError {
    let text: String
    var errorDescription: String? { text }
}

@MainActor @Observable
final class Haru {
    struct Message: Identifiable {
        let id: String
        var role: String        // "user", "assistant", anything else is a note
        var content: String
        var aside = false       // hers, but not addressed to you
    }

    var messages: [Message] = []
    var busy = false
    var error: String?

    /// Where she answers. The tunnel's https address in normal use.
    var url = UserDefaults.standard.string(forKey: "haru.url") ?? "" {
        didSet { UserDefaults.standard.set(url, forKey: "haru.url") }
    }

    /// Whether to ask her to say her replies out loud.
    var voice = UserDefaults.standard.bool(forKey: "haru.voice") {
        didSet { UserDefaults.standard.set(voice, forKey: "haru.voice") }
    }

    private var token = Keychain.read()
    var signedIn: Bool { token != nil }

    private var player: AVAudioPlayer?

    // MARK: - The wire

    private func request(_ path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let base = URL(string: trimmed), base.scheme != nil, base.host() != nil else {
            throw Fail(text: "Set her address first, in the settings.")
        }
        var r = URLRequest(url: base.appending(path: path))
        r.httpMethod = method
        r.httpBody = body
        // Ours is the only Cookie header, and it is the one that works. See above.
        r.httpShouldHandleCookies = false
        if body != nil { r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { r.setValue("haru_device=\(token)", forHTTPHeaderField: "Cookie") }
        r.timeoutInterval = 180  // she thinks for a while before she answers
        return r
    }

    /// Turns her JSON refusals into something worth showing, and drops the token
    /// when it has gone stale so the sign-in sheet comes back on its own.
    private func check(_ response: URLResponse, _ data: Data?) throws {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard code != 200 else { return }
        if code == 401 { forget() }
        let said = data
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            .flatMap { $0["error"] as? String }
        throw Fail(text: said ?? "She answered \(code).")
    }

    // MARK: - Signing in

    func signIn(username: String, password: String) async {
        error = nil
        do {
            let body = try JSONSerialization.data(withJSONObject: [
                "username": username,
                "password": password,
                // Remembered, so this happens once. The sign-in route is rate
                // limited on purpose and logging in per launch walks into it.
                "remember": true,
                "device": UIDevice.current.name,
            ])
            let r = try request("/api/login", method: "POST", body: body)
            let (data, response) = try await URLSession.shared.data(for: r)
            try check(response, data)

            let fields = (response as? HTTPURLResponse)?.allHeaderFields as? [String: String] ?? [:]
            let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: r.url!)
            guard let device = cookies.first(where: { $0.name == "haru_device" })?.value else {
                throw Fail(text: "She signed us in but sent no device token, which should not happen.")
            }
            token = device
            Keychain.write(device)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func forget() {
        token = nil
        Keychain.write(nil)
        messages = []
    }

    // MARK: - The conversation

    func load() async {
        guard signedIn else { return }
        struct Reply: Decodable {
            struct Item: Decodable { let id: String?; let role: String; let content: String; let aside: String? }
            let messages: [Item]
        }
        do {
            let (data, response) = try await URLSession.shared.data(for: request("/api/chat"))
            try check(response, data)
            messages = try JSONDecoder().decode(Reply.self, from: data).messages.map {
                Message(id: $0.id ?? UUID().uuidString, role: $0.role, content: $0.content, aside: $0.aside != nil)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func send(_ text: String) async {
        let said = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !said.isEmpty, !busy else { return }
        error = nil
        busy = true
        defer { busy = false }

        messages.append(Message(id: UUID().uuidString, role: "user", content: said))
        let replyID = UUID().uuidString
        messages.append(Message(id: replyID, role: "assistant", content: ""))

        do {
            let body = try JSONSerialization.data(withJSONObject: ["text": said])
            let (bytes, response) = try await URLSession.shared.bytes(for: request("/api/chat/stream", method: "POST", body: body))
            try check(response, nil)

            var reply = ""
            for try await line in bytes.lines {
                guard line.hasPrefix("data: "),
                      let event = try? JSONSerialization.jsonObject(with: Data(line.dropFirst(6).utf8)) as? [String: Any]
                else { continue }

                if let chunk = event["text"] as? String {
                    // A round thrown away at the last moment — a tool call was
                    // coming, a retry was pressed — announces itself as a lone
                    // U+FFFD. What was shown is taken back and she starts again.
                    if chunk == "\u{FFFD}" { reply = "" } else { reply += chunk }
                    write(replyID, reply)
                }
                if let bad = event["error"] as? String { throw Fail(text: bad) }
                if event["done"] as? Bool == true {
                    reply = event["reply"] as? String ?? reply
                    write(replyID, reply)
                }
            }
            await speak(reply)
        } catch {
            self.error = error.localizedDescription
            messages.removeAll { $0.id == replyID && $0.content.isEmpty }
        }
    }

    private func write(_ id: String, _ text: String) {
        guard let at = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[at].content = text
    }

    // MARK: - Her voice

    /// Asked for separately for the reason her page asks separately: synthesis
    /// costs a whole round trip, and a reply that waits for one arrives late.
    private func speak(_ text: String) async {
        guard voice, !text.isEmpty else { return }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["text": String(text.prefix(2000))])
            let (data, response) = try await URLSession.shared.data(for: request("/api/speak", method: "POST", body: body))
            // 503 is her voice not being set up, which is a choice on the
            // desktop rather than a fault here. Nothing to say about it.
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
            player = try AVAudioPlayer(data: data)
            player?.play()
        } catch {
            // Silence is the right failure here: the words are already on screen.
        }
    }
}

/// The device token is a credential, so it lives where credentials live.
enum Keychain {
    private static let account = "haru.device"

    static func read() -> String? {
        var out: CFTypeRef?
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String?) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var add = query
        add[kSecValueData as String] = data
        // After first unlock, so a background refresh can still reach her.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}
