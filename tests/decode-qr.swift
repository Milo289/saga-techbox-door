import Foundation
import CoreImage
// prints the text of the QR code in each given image (the same scanner the phone camera uses)
let det = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
for path in CommandLine.arguments.dropFirst() {
    guard let img = CIImage(contentsOf: URL(fileURLWithPath: path)) else { print("NOIMAGE"); continue }
    let f = det.features(in: img).compactMap { $0 as? CIQRCodeFeature }
    print(f.first?.messageString ?? "NOTFOUND")
}
