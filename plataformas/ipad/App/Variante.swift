/// Which app this is: Zinarix Studio for the iPad (works on its own, plus a side bar with
/// the computers and several windows). The rest of the code is shared with the iPhone app (plataformas/ios-comun/Fuentes).
enum Variante {
    static let esIPad = true
    /// The app also works on its own, without a computer (LocalViewController + Web/).
    static let independiente = true
    static let nombre = "Zinarix Studio"
}
