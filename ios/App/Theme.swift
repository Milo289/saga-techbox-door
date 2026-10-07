import SwiftUI

extension View {
    /// The rounded card all sections of the app sit in.
    func card(_ padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

struct SectionTitle: View {
    let text: String
    var symbol: String?
    init(_ text: String, symbol: String? = nil) { self.text = text; self.symbol = symbol }
    var body: some View {
        HStack(spacing: 6) {
            if let symbol { Image(systemName: symbol).font(.footnote.weight(.semibold)) }
            Text(text.uppercased()).font(.footnote.weight(.semibold)).tracking(0.8)
        }.foregroundStyle(.secondary).padding(.horizontal, 4)
    }
}

/// A pill the person taps to choose (a duration, a quick reply, …).
struct Chip: View {
    let text: String
    var symbol: String?
    var selected = false
    var tint: Color = .white
    let action: () -> Void
    var body: some View {
        Button { Haptics.tap(); action() } label: {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.footnote.weight(.semibold)) }
                Text(text).font(.subheadline.weight(.semibold)).lineLimit(1)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(selected ? tint : Color.white.opacity(0.10), in: Capsule())
            .foregroundStyle(selected ? Color.black : Color.white)
        }.buttonStyle(.plain)
    }
}

/// Wraps its children onto several lines.
struct Flow: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += row + spacing; row = 0 }
            x += size.width + spacing; row = max(row, size.height)
        }
        return CGSize(width: width, height: y + row)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += row + spacing; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing; row = max(row, size.height)
        }
    }
}

struct PrimaryButton: ButtonStyle {
    var tint: Color = .white
    var fg: Color = .black
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14)
            .background(tint.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .foregroundStyle(fg)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(duration: 0.2), value: configuration.isPressed)
    }
}

/// The small message that slides in at the top.
struct BannerView: View {
    @ObservedObject var store: DoorStore
    var body: some View {
        VStack {
            if let text = store.banner {
                Text(text).font(.subheadline.weight(.semibold)).foregroundStyle(.black)
                    .padding(.horizontal, 18).padding(.vertical, 12).background(.white, in: Capsule())
                    .shadow(radius: 12, y: 4).padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            Spacer()
        }
        .animation(.spring(duration: 0.35), value: store.banner)
        .allowsHitTesting(false)
    }
}
