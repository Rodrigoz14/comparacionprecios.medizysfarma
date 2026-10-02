import { describe, expect, it } from "vitest";
import { extractIngredientGuess, extractProductAttributes, normalizeDosageForm } from "@/lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName } from "@/lib/matching/normalize";

describe("extractProductAttributes", () => {
  it("extrae atributos de 'ACETAMINOFEN TAB 500MG X100'", () => {
    const result = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    expect(result).not.toBeNull();
    expect(result?.attributes).toMatchObject({
      activeIngredient: "ACETAMINOFEN",
      concentration: "500",
      concentrationUnit: "MG",
      dosageForm: "Tableta",
      presentationQuantity: 100,
    });
  });

  it("extrae atributos de 'PARACETAMOL 500 MG TABLETAS CAJA X 100'", () => {
    const result = extractProductAttributes("PARACETAMOL 500 MG TABLETAS CAJA X 100");
    expect(result).not.toBeNull();
    expect(result?.attributes).toMatchObject({
      activeIngredient: "PARACETAMOL",
      concentration: "500",
      concentrationUnit: "MG",
      dosageForm: "Tableta",
      presentationType: "Caja",
      presentationQuantity: 100,
    });
  });

  it("extrae la concentracion compuesta de 'AMOXICILINA + CLAVULANATO 500/125 MG X21'", () => {
    const result = extractProductAttributes("AMOXICILINA + CLAVULANATO 500/125 MG X21");
    expect(result).not.toBeNull();
    expect(result?.attributes.concentration).toBe("500/125");
    expect(result?.attributes.presentationQuantity).toBe(21);
  });

  // Casos tomados de un archivo real de Ramedicas (.xlsm), donde la presentacion
  // suele venir en su propia columna, separada del nombre del producto.
  describe("presentaciones por volumen/peso (columna separada, sin espacio antes de la unidad)", () => {
    it("convierte litros a mililitros", () => {
      const result = extractProductAttributes("LOSARTAN 50MG SOLUCION ORAL FRASCO X 1.5L");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(1500);
      expect(result?.attributes.presentationUnit).toBe("ml");
    });

    it("reconoce mililitros pegados a la unidad (X 30ML)", () => {
      const result = extractProductAttributes(
        "RISPERIDONA 1MG/ML (0,1%) SOLUCION ORAL CAJA CON FRASCO X 30ML",
      );
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(30);
      expect(result?.attributes.presentationUnit).toBe("ml");
    });

    it("reconoce gramos pegados a la unidad (X 400G)", () => {
      const result = extractProductAttributes(
        "APME EN POLVO FORMULA POLIMERICA PARA NINOS LATA X 400G",
      );
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(400);
      expect(result?.attributes.presentationUnit).toBe("g");
    });

    it("bug real (2026-09-29): reconoce el tamaño del envase aunque no vaya pegado a una 'X' (Ofimedicas: 'Tarro 400 g x 1')", () => {
      // El "x 1" del final es cuántos tarros trae la caja (1), no el tamaño
      // del tarro (400g) -- antes se quedaba con el "x1" y el producto
      // quedaba guardado como presentación "1 ml", carísimo por unidad.
      const result = extractProductAttributes(
        "Poliestireno Sulfonato Calcico 99 % polvo para reconstituir solucion o suspension oral Tarro 400 g x 1",
      );
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(400);
      expect(result?.attributes.presentationUnit).toBe("g");
    });

    it("no confunde una dosis repetida ('AMP 1G') con el tamaño del envase -- conserva el conteo real del 'X10'", () => {
      // El respaldo de tamaño suelto no debe robarle el conteo real de
      // ampollas a un "X10" solo porque la dosis (1g) se repite en el texto.
      const result = extractProductAttributes("Ampicilina 1 g inyectable amp 1 g x 10 FARMALOGICA 20102511-01");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(10);
      expect(result?.attributes.presentationUnit).toBe("ampollas");
    });
  });

  it("asume cantidad 1 para envases de una sola unidad sin numero explicito (CAJA X VIAL)", () => {
    const result = extractProductAttributes(
      "TOXINA BOTULINICA TIPO A 100UI POLVO A SOLUCION INYECTABLE CAJA X VIAL",
    );
    expect(result).not.toBeNull();
    expect(result?.attributes.presentationQuantity).toBe(1);
    expect(result?.warnings.some((w) => w.includes("se asumió 1"))).toBe(true);
  });

  it("quita el prefijo de canal EPS- del ingrediente activo (dato real Disfarma)", () => {
    const conPrefijo = extractProductAttributes("EPS-ZOPICLONA 7.5MG C*30 TAB - RECIPE");
    const sinPrefijo = extractProductAttributes("ZOPICLONA 7.5MG C*30 TAB - RECIPE");
    expect(conPrefijo).not.toBeNull();
    expect(conPrefijo?.attributes.activeIngredient).toBe("ZOPICLONA");
    // Con o sin el prefijo del proveedor, debe quedar la misma clave generica
    // para que un cliente que escribe "Zopiclona" (sin EPS-) sí lo encuentre.
    expect(buildGenericKey(conPrefijo!.attributes)).toBe(buildGenericKey(sinPrefijo!.attributes));
  });

  // Casos tomados de un archivo real de Disfarma, que usa "*" en vez de "X"
  // como separador de cantidad.
  describe("separador de presentacion con asterisco (Disfarma)", () => {
    it("reconoce '*30' igual que 'X30'", () => {
      const result = extractProductAttributes("ABACAVIR 600MG FCO*30 TAB");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(30);
    });

    it("prefiere el volumen explicito sobre un conteo de envases cuando hay varias coincidencias", () => {
      // "C*1" (1 envase) aparece antes que "X 240ML" (el contenido real).
      const result = extractProductAttributes("ABACAVIR 20MG/ML SOL ORL C*1 FCO X 240ML");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(240);
      expect(result?.attributes.presentationUnit).toBe("ml");
    });

    it("asume cantidad 1 para 'FCO*1' sin unidad explicita, igual que con X", () => {
      const result = extractProductAttributes("PRODUCTO 100MG CAJA*VIAL");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(1);
    });

    it("prefiere la cantidad mas grande cuando ninguna coincidencia trae unidad (conteo de envases vs. contenido real)", () => {
      // Bug real (2026-09-22): "C*1" (1 frasco) se quedaba con la cantidad
      // por aparecer primero en el texto, dejando "X 60" (las 60 tabletas
      // reales) sin usar -- el precio de empaque se calculaba como si el
      // frasco trajera 1 sola tableta en vez de 60.
      const result = extractProductAttributes("ABACAVIR 300MG C*1 FCO X 60 TAB");
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(60);
    });
  });

  it("no confunde equipo medico sin concentracion farmacologica (correctamente null)", () => {
    // "UNIDAD" no tiene ni concentracion ni un patron de cantidad reconocible.
    expect(extractProductAttributes("LECTOR FRESTYLE LIBRE 2 UNIDAD")).toBeNull();
  });

  it("reconoce presentaciones distintas del mismo producto como el mismo generico (se comparan por unidad)", () => {
    const x100 = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    const x20 = extractProductAttributes("ACETAMINOFEN TAB 500MG X20");
    expect(x100?.attributes.presentationQuantity).not.toBe(x20?.attributes.presentationQuantity);
    // La presentacion ya no forma parte de la clave generica: caja x100 y caja
    // x20 del mismo medicamento deben quedar bajo la misma clave para poder
    // compararse por precio unitario en el motor de precios.
    expect(buildGenericKey(x100!.attributes)).toBe(buildGenericKey(x20!.attributes));
    expect(buildNormalizedName(x100!.attributes, null)).not.toBe(buildNormalizedName(x20!.attributes, null));
  });

  it("devuelve null cuando no hay concentracion ni presentacion reconocibles", () => {
    expect(extractProductAttributes("PRODUCTO SIN DATOS CLAROS")).toBeNull();
  });

  it("devuelve null cuando falta la unidad de concentracion (evita adivinar)", () => {
    expect(extractProductAttributes("AMOXICILINA 500/125 X21")).toBeNull();
  });

  describe("requirePresentation: false (busqueda de cliente)", () => {
    it("sigue devolviendo null sin concentracion, con o sin presentacion", () => {
      expect(extractProductAttributes("PRODUCTO SIN DATOS CLAROS", { requirePresentation: false })).toBeNull();
    });

    it("no devuelve null cuando falta la presentacion; asume cantidad 1", () => {
      const result = extractProductAttributes("ACIDO VALPROICO 250MG CAPSULA", { requirePresentation: false });
      expect(result).not.toBeNull();
      expect(result?.attributes).toMatchObject({
        activeIngredient: "ACIDO VALPROICO",
        concentration: "250",
        concentrationUnit: "MG",
        dosageForm: "Cápsula",
        presentationQuantity: 1,
      });
    });

    it("sigue exigiendo presentacion por defecto (importacion de proveedores)", () => {
      expect(extractProductAttributes("ACIDO VALPROICO 250MG CAPSULA")).toBeNull();
    });

    it("no confunde la 'x' usada como separador antes de la dosis con un multiplicador de empaque", () => {
      // Bug real: "Esomeprazol x 40 mg" no encontraba nada porque la "X"
      // quedaba pegada al principio activo extraido ("ESOMEPRAZOL X"), ya que
      // el mismo numero de la concentracion tambien calzaba con el patron de
      // cantidad de presentacion ("X 40").
      const result = extractProductAttributes("Esomeprazol x 40 mg", { requirePresentation: false });
      expect(result).not.toBeNull();
      expect(result?.attributes).toMatchObject({
        activeIngredient: "ESOMEPRAZOL",
        concentration: "40",
        concentrationUnit: "MG",
        presentationQuantity: 1,
      });
    });

    it("sigue reconociendo un multiplicador de empaque legitimo aunque comparta digitos con la concentracion (LATA X 400G)", () => {
      const result = extractProductAttributes(
        "APME EN POLVO FORMULA POLIMERICA PARA NINOS LATA X 400G",
        { requirePresentation: false },
      );
      expect(result).not.toBeNull();
      expect(result?.attributes.presentationQuantity).toBe(400);
      expect(result?.attributes.presentationUnit).toBe("g");
    });

    it("no confunde el volumen del envase (ML/L tras 'X'/'*') con la concentracion del medicamento", () => {
      // Bug real: el cliente busco "Hidroxido de aluminio + Simeticona
      // suspension x 360 ml" (sin decir la concentracion real) y no
      // encontro nada, porque "360 ML" (el volumen del frasco) se tomaba
      // como si fuera la concentracion -- ningun producto real tiene esa
      // "concentracion", asi que la busqueda siempre fallaba. A diferencia
      // del peso (G, ver LATA X 400G arriba), un volumen introducido por
      // "X"/"*" es siempre tamaño de envase, nunca concentracion.
      expect(
        extractProductAttributes("Hidróxido de aluminio + simeticona suspensión x 360 ml", {
          requirePresentation: false,
        }),
      ).toBeNull();
    });
  });

  it("reconoce una concentracion en porcentaje ('0.5%'), no solo en mg/ml", () => {
    // Bug real: el cliente busco "Carboximetilcelulosa gotas al 0.5%" y no
    // encontro nada, porque el signo "%" no era una unidad reconocida (el
    // catalogo guarda la misma concentracion como "5MG/ML").
    const result = extractProductAttributes("Carboximetilcelulosa gotas al 0.5%", { requirePresentation: false });
    expect(result).not.toBeNull();
    expect(result?.attributes).toMatchObject({
      activeIngredient: "CARBOXIMETILCELULOSA",
      concentration: "0.5",
      concentrationUnit: "%",
      dosageForm: "Solución",
    });
  });

  it("bug real (2026-09-29): dos proveedores escriben la misma concentracion distinto (razon G/ML vs %) y deben quedar con la misma clave", () => {
    // Ramédicas: "2G/10ML (0,2G/ML) (20%)". Disfarma: "20% SOL INY". Son el
    // mismo Sulfato de Magnesio, pero antes quedaban con concentracion "2 G"
    // y "20 %" respectivamente -- generic_key distinto, nunca se comparaban.
    const ramedicas = extractProductAttributes(
      "MAGNESIO SULFATO 2G/10ML (0,2G/ML) (20%) SOLUCION INYECTABLE CAJA X10",
    );
    const disfarma = extractProductAttributes("EPS-SULFATO MAGNESIO 20% SOL INY AMPX10ML CX40 - ROPSOHN");
    expect(ramedicas?.attributes.concentration).toBe("20");
    expect(ramedicas?.attributes.concentrationUnit).toBe("%");
    expect(disfarma?.attributes.concentration).toBe("20");
    expect(disfarma?.attributes.concentrationUnit).toBe("%");
  });

  it("bug real (2026-09-29): 'X/100G' (misma unidad arriba y abajo) se prefiere como '%' cuando el texto lo trae explicito", () => {
    // Catalogo: "0,2G/100G (0,2%)". Cliente escribe directo "0.2%". Antes el
    // catalogo quedaba en concentracion "0.2 G" (de la razon) y no coincidia
    // con lo que escribe un cliente o cualquier proveedor que solo ponga "%".
    const catalogo = extractProductAttributes("NITROFURAZONA 0,2G/100G (0,2%) POMADA TOPICA CAJA X40");
    const cliente = extractProductAttributes("NITROFURAZONA POMADA  0.2 %/40 G", { requirePresentation: false });
    expect(catalogo?.attributes.concentration).toBe("0.2");
    expect(catalogo?.attributes.concentrationUnit).toBe("%");
    expect(cliente?.attributes.concentration).toBe("0.2");
    expect(cliente?.attributes.concentrationUnit).toBe("%");
  });

  it("bug real (2026-09-30): 'XMG/YML' se reduce a 'por 1 ml', para que distintos volumenes de referencia den la misma concentracion", () => {
    // "50MG/5ML" (10mg por cada ml) y "10MG/1ML" o "10MG/ML" (denominador 1
    // implicito) son la misma concentracion real, escrita de tres formas.
    // Forma NO sellada (suspension/solucion oral, jarabe...) a proposito: para
    // un frasco que se mide, el volumen de referencia realmente no importa.
    const a = extractProductAttributes("MEDICAMENTOTEST 50MG/5ML SUSPENSION ORAL", { requirePresentation: false });
    const b = extractProductAttributes("MEDICAMENTOTEST 10MG/1ML SUSPENSION ORAL", { requirePresentation: false });
    const c = extractProductAttributes("MEDICAMENTOTEST 10MG/ML SUSPENSION ORAL", { requirePresentation: false });
    expect(a?.attributes.concentration).toBe("10");
    expect(a?.attributes.concentrationUnit).toBe("MG/ML");
    expect(b?.attributes.concentration).toBe("10");
    expect(b?.attributes.concentrationUnit).toBe("MG/ML");
    expect(c?.attributes.concentration).toBe("10");
    expect(c?.attributes.concentrationUnit).toBe("MG/ML");
    expect(buildGenericKey(a!.attributes)).toBe(buildGenericKey(b!.attributes));
    expect(buildGenericKey(a!.attributes)).toBe(buildGenericKey(c!.attributes));
  });

  it("bug real (2026-10-01): '1.000MG' (convencion colombiana de miles) no se confunde con un decimal -- son 1000mg, no 1mg", () => {
    // Confirmado en datos reales de produccion: "ACETAMINOFEN (PARACETAMOL)
    // 1.000MG/100ML..." (Ramedicas) se leia como concentracion "1" (JS
    // interpreta el punto como decimal), un error de 1000x. Forma NO sellada
    // a proposito, para probar solo el parseo de miles de la dosis, sin
    // mezclarlo con el manejo aparte del volumen en formas selladas.
    const result = extractProductAttributes("ACETAMINOFEN 1.000MG TABLETA", {
      requirePresentation: false,
    });
    expect(result?.attributes.concentration).toBe("1000");
    expect(result?.attributes.concentrationUnit).toBe("MG");
  });

  it("'0.625MG/G' (decimal real menor a 1) no se confunde con miles solo porque tiene 3 cifras despues del punto", () => {
    const result = extractProductAttributes("ESTROGENOS CONJUGADOS 0.625MG/G CREMA VAGINAL X43G");
    expect(result?.attributes.concentration).toBe("0.625");
  });

  it("bug real (2026-10-01): 'ACETAMINOFEN (PARACETAMOL)' no deja un parentesis sin cerrar en el principio activo", () => {
    // El recorte de puntuacion se comia el ")" de cierre (porque queda justo
    // antes de la concentracion) pero dejaba el "(" de apertura colgando --
    // "ACETAMINOFEN (PARACETAMOL" nunca coincidia con el "ACETAMINOFEN" liso
    // que reportan otros proveedores para el mismo medicamento.
    const conAlias = extractProductAttributes("ACETAMINOFEN (PARACETAMOL) 10MG/ML (1%) SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    const sinAlias = extractProductAttributes("ACETAMINOFEN 10MG/ML (1%) SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    expect(conAlias?.attributes.activeIngredient).toBe("ACETAMINOFEN");
    expect(buildGenericKey(conAlias!.attributes)).toBe(buildGenericKey(sinAlias!.attributes));
  });

  it("bug real (2026-10-01): 'GR' (gramos) y 'MEQ' (miliequivalentes) se reconocen como unidades de concentracion", () => {
    // Antes "1 GR" ni siquiera se reconocia como concentracion (la extraccion
    // fallaba por completo, GR no estaba en la lista de unidades), y "2MEQ"
    // hacia que el regex agarrara por error otro numero del texto (el volumen
    // del envase) como si fuera la concentracion.
    const gr = extractProductAttributes("CEFAZOLINA 1GR C*10AMP", { requirePresentation: false });
    expect(gr?.attributes.concentration).toBe("1");
    expect(gr?.attributes.concentrationUnit).toBe("G");

    const meq = extractProductAttributes("CLORURO DE POTASIO 2MEQ/ML SOL INY AMPOULEPACKX10ML CX40", {
      requirePresentation: false,
    });
    expect(meq?.attributes.concentration).toBe("2");
    expect(meq?.attributes.concentrationUnit).toBe("MEQ");
  });

  it("bug real (2026-10-01): para formas SELLADAS (ampolla/inyectable) la razon MG/ML NO se reduce -- el volumen es el contenido total de ESA presentacion, no se fracciona", () => {
    // Bug real confirmado en produccion: Enoxaparina 40MG/0.4ML, 60MG/0.6ML y
    // 80MG/0.8ML son TRES jeringas precargadas de dosis real distinta, pero
    // las tres reducen a la misma concentracion "100MG/ML" -- si se redujera,
    // quedarian con la MISMA clave generica, como si fueran intercambiables.
    // (El volumen SÍ queda en la clave -- ver el siguiente bug, 2026-10-02 --
    // pero sin reducir la razon: "40/0.4", no "100".)
    const d40 = extractProductAttributes("ENOXAPARINA 40MG/0.4ML SOLUCION INYECTABLE", { requirePresentation: false });
    const d60 = extractProductAttributes("ENOXAPARINA 60MG/0.6ML SOLUCION INYECTABLE", { requirePresentation: false });
    expect(d40?.attributes.concentration).toBe("40/0.4");
    expect(d40?.attributes.concentrationUnit).toBe("MG/ML");
    expect(d60?.attributes.concentration).toBe("60/0.6");
    expect(d60?.attributes.concentrationUnit).toBe("MG/ML");
    expect(buildGenericKey(d40!.attributes)).not.toBe(buildGenericKey(d60!.attributes));
  });

  it("bug real (2026-10-02): el volumen SÍ se agrega a la clave de una forma sellada cuando es explícito y distinto de 1ml", () => {
    // Confirmado en datos reales de producción: "BACLOFENO 10MG/20ML"
    // (0,5mg/ml) y "BACLOFENO 10MG/5ML" (2mg/ml) tienen la MISMA dosis total
    // pero son dos presentaciones reales con concentración distinta -- antes
    // quedaban fusionadas en una sola clave genérica. Mismo caso real con
    // Docetaxel, Dexmedetomidina (premezcla diluida vs. vial concentrado).
    const d20 = extractProductAttributes("BACLOFENO 10MG/20ML (0,5MG/ML) SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    const d5 = extractProductAttributes("BACLOFENO 10MG/5ML (2MG/ML) SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    expect(d20?.attributes.concentration).toBe("10/20");
    expect(d5?.attributes.concentration).toBe("10/5");
    expect(buildGenericKey(d20!.attributes)).not.toBe(buildGenericKey(d5!.attributes));

    // Pero un denominador implícito o igual a 1 ("20MG/ML", "20MG/1ML") NO se
    // agrega -- son la misma presentación que un proveedor que de plano omite
    // el "/ML" (bug real: esto rompía la Hioscina N-Butil Bromuro, cuyo
    // envase SIEMPRE es de 1ml, entre un proveedor que escribe "20MG/ML" y
    // otro que solo pone "20MG").
    const sinDenominador = extractProductAttributes("HIOSCINA N-BUTIL BROMURO 20MG SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    const conMl = extractProductAttributes("HIOSCINA N-BUTIL BROMURO 20MG/ML SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    const con1Ml = extractProductAttributes("HIOSCINA N-BUTIL BROMURO 20MG/1ML SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    expect(conMl?.attributes.concentration).toBe("20");
    expect(buildGenericKey(sinDenominador!.attributes)).toBe(buildGenericKey(conMl!.attributes));
    expect(buildGenericKey(sinDenominador!.attributes)).toBe(buildGenericKey(con1Ml!.attributes));
  });

  it("bug real (2026-10-02): 'SIN EPINEFRINA'/'S/EPINEFRINA' es la presentacion por defecto -- coincide con la version sin ninguna aclaracion", () => {
    // Confirmado en datos reales de produccion: proveedores que aclaran "sin
    // epinefrina" y proveedores que simplemente no mencionan epinefrina
    // (significa lo mismo, sin vasoconstrictor) nunca coincidian entre si.
    const sinAclarar = extractProductAttributes("EPS-BUPIVACAINA 50MG/10ML (0.5%) SOL INY AMPX10ML CX100 - BIOSANO", {
      requirePresentation: false,
    });
    const sinEpinefrina = extractProductAttributes("Bupivacaina sin epinefrina 0.5 % solucion inyectable amp 10 mL x 100 BIOSANO", {
      requirePresentation: false,
    });
    const sBarraEpinefrina = extractProductAttributes("BUPIVACAINA S/EPINEFRINA 50MG/10ML (5MG/ML) (0,5%) SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    expect(buildGenericKey(sinAclarar!.attributes)).toBe(buildGenericKey(sinEpinefrina!.attributes));
    expect(buildGenericKey(sinAclarar!.attributes)).toBe(buildGenericKey(sBarraEpinefrina!.attributes));

    // "CON epinefrina" SI es una presentacion distinta (con vasoconstrictor) -- no se quita.
    const conEpinefrina = extractProductAttributes("Bupivacaina Con Epinefrina 0.5 % solucion inyectable amp 10 mL x 24 ROPSOHN", {
      requirePresentation: false,
    });
    expect(conEpinefrina?.attributes.activeIngredient).toBe("BUPIVACAINA CON EPINEFRINA");
    expect(buildGenericKey(conEpinefrina!.attributes)).not.toBe(buildGenericKey(sinAclarar!.attributes));
  });

  it("bug real (2026-10-02): 'POLVO PARA RECONSTITUIR' sin decir a que (oral/inyectable) se reconoce como Inyectable", () => {
    // Confirmado en datos reales de producción: un cliente escribio
    // "AMPICILINA SODICA + SULBACTAM SODICO POLVO PARA RECONSTITUIR 1.5G
    // VIAL" -- sin NINGUN marcador de forma farmaceutica reconocido antes de
    // este fix, asi que la frase completa quedaba pegada al principio
    // activo, rompiendo la homologacion.
    const result = extractProductAttributes(
      "AMPICILINA SODICA + SULBACTAM SODICO POLVO PARA RECONSTITUIR 1.5G VIAL",
      { requirePresentation: false },
    );
    expect(result?.attributes.activeIngredient).toBe("AMPICILINA + SULBACTAM");
    expect(result?.attributes.dosageForm).toBe("Inyectable");

    // Cuando SI dice "oral" en algun lado, sigue reconociendose como antes
    // (no se fuerza a Inyectable por error).
    const oral = extractProductAttributes(
      "Ampicilina 250 mg /5mL polvo para reconstituir solucion o suspension oral fco 60 mL x 1 LASANTE",
      { requirePresentation: false },
    );
    expect(oral?.attributes.dosageForm).not.toBe("Inyectable");
  });

  it("bug real (2026-10-02): adjetivos de sal ('SODICA'/'SODICO'/'POTASICA'...) no cambian la identidad del principio activo", () => {
    // Mismo criterio ya confirmado con "Dipirona"/"Dipirona Sodica": la sal
    // no es una sustancia distinta para homologar en este catalogo.
    const conSal = extractProductAttributes("DICLOFENACO SODICO 50MG TABLETA", { requirePresentation: false });
    const sinSal = extractProductAttributes("DICLOFENACO 50MG TABLETA", { requirePresentation: false });
    expect(conSal?.attributes.activeIngredient).toBe("DICLOFENACO");
    expect(buildGenericKey(conSal!.attributes)).toBe(buildGenericKey(sinSal!.attributes));
  });

  it("bug real (2026-10-02): combinado con cada dosis pegada a su propio principio ('Ampicilina 1 g + Sulbactam 0.5 g') no pierde el segundo principio", () => {
    // Confirmado en datos reales de produccion (Ofimedicas): a diferencia de
    // "AMPICILINA + SULBACTAM 1G+0.5G" (nombres juntos, dosis juntas, ya
    // soportado), aqui cada principio trae pegada su propia dosis antes del
    // "+" siguiente. Sin el fix, todo lo que sigue al primer "+" se perdia:
    // quedaba como Ampicilina sola, sin Sulbactam.
    const intercalado = extractProductAttributes(
      "Ampicilina 1 g + Sulbactam 0.5 g inyectable amp 1.5 g x 10 ampidelt DELTA 20036512-02",
      { requirePresentation: false },
    );
    const formatoJunto = extractProductAttributes("AMPICILINA + SULBACTAM 1G+0,5G POLVO A SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    expect(intercalado?.attributes.activeIngredient).toBe("AMPICILINA + SULBACTAM");
    expect(intercalado?.attributes.concentration).toBe("1/0.5");
    expect(buildGenericKey(intercalado!.attributes)).toBe(buildGenericKey(formatoJunto!.attributes));

    // Una Ampicilina sola (sin combinar) sigue siendo un producto distinto.
    const sola = extractProductAttributes("Ampicilina 1 g inyectable amp 1 g x 10 FARMALOGICA 20102511-01", {
      requirePresentation: false,
    });
    expect(buildGenericKey(sola!.attributes)).not.toBe(buildGenericKey(intercalado!.attributes));
  });

  it("formula con 3+ principios en formato intercalado no se intenta -- evita fusionar formulas distintas que comparten los primeros dos", () => {
    // Encontrado antes de desplegar el fix anterior: "Acido Ascorbico 100mg +
    // Acido Folico 2mg + Fumarato Ferroso 330mg + Vitamina B12 1mg" quedaba
    // como "acido ascorbico + acido folico" (perdiendo los ultimos dos
    // principios) si el patron intercalado no se limitaba a exactamente 2 --
    // dos complejos vitaminicos DISTINTOS que comparten los primeros dos
    // componentes habrian quedado con la misma clave generica.
    const result = extractProductAttributes(
      "Acido Ascorbico 100 mg + Acido Folico 2 mg + fumarato ferroso 330 mg + Vitamina B12 1 mg capsula dura Caja x 30",
      { requirePresentation: false },
    );
    expect(result?.attributes.activeIngredient).toBe("ACIDO ASCORBICO");
    expect(result?.attributes.concentration).toBe("100");
  });

  it("bug real (2026-10-02): un tamaño de envase con 3 decimales ('X1.750ML') no se confunde con miles EN una jeringa precargada", () => {
    // Confirmado en datos reales de producción: la jeringa precargada de
    // Paliperidona (Invega Trinza) trae "JERPREX1.750ML" -- 1.75 ml reales,
    // no "1750 ml". El fix de miles (1.000MG = 1000) es correcto para DOSIS,
    // pero aplicado tal cual al tamaño del envase convertía por error 1.75 en
    // 1750 -- ninguna jeringa precargada real mide litro y medio.
    const r1 = extractProductAttributes(
      "EPS-PALIPERIDONA 350MG/1.750ML SUSP INY JERPREX1.750ML CX1 (INVEGA TRINZA 546MG - 3 MESES) - JANSSEN",
      { requirePresentation: false },
    );
    // El volumen tambien entra a la concentracion (forma sellada, ver bug
    // anterior) -- "350/1.75", no "350/1750": la misma deteccion de jeringa
    // precargada aplica tanto al tamano de envase como a este denominador.
    expect(r1?.attributes.concentration).toBe("350/1.75");
    expect(r1?.attributes.presentationQuantity).toBe(2); // 1.75 redondeado, no 1750

    const r2 = extractProductAttributes(
      "EPS-PALIPERIDONA 263MG/1.315ML SUSP INY JERPREX1.315ML CX1 (INVEGA TRINZA 410MG - 3 MESES) - JANSSEN",
      { requirePresentation: false },
    );
    expect(r2?.attributes.presentationQuantity).toBe(1); // 1.315 redondeado, no 1315
  });

  it("bug real (2026-10-02): un tamaño de envase con 3 decimales SÍ se interpreta como miles fuera de una jeringa precargada", () => {
    // Confirmado en datos reales de producción: bolsas/frascos de suero y
    // soluciones de gran volumen SÍ usan "." como separador de miles en el
    // tamaño del envase ("SOLUCION INYECTABLE X 1.000ML" es una bolsa de 1
    // litro, no de 1 ml) -- antes de este fix, estos quedaban todos en "1 ml"
    // (el mismo bug que las jeringas, pero en sentido contrario: aquí SÍ hay
    // que leerlo como miles).
    expect(
      extractProductAttributes("SODIO CLORURO (0,9%) SOLUCION INYECTABLE X 1.000ML", { requirePresentation: false })
        ?.attributes.presentationQuantity,
    ).toBe(1000);
    expect(
      extractProductAttributes("SODIO CLORURO (0,9%) SOLUCION INYECTABLE X 3.000ML", { requirePresentation: false })
        ?.attributes.presentationQuantity,
    ).toBe(3000);
    expect(
      extractProductAttributes("FORMOL (10%) GALON X 3.800ML", { requirePresentation: false })?.attributes
        .presentationQuantity,
    ).toBe(3800);
  });

  it("bug real (2026-09-29): 'AMP'/'AMPOLLA' (el envase) ya no es una forma farmaceutica aparte de 'Inyectable'", () => {
    // Bodega registraba "DICLOFENACO 75MG/3ML C*100 AMP X 3ML" (sin decir
    // "solucion inyectable") y nunca coincidia con el "DICLOFENACO 75MG/3ML
    // SOLUCION INYECTABLE" del catalogo -- mismo medicamento, forma
    // farmaceutica distinta ("Ampolla" vs "Inyectable"), generic_key distinto.
    const bodega = extractProductAttributes("DICLOFENACO 75MG/3ML C*100 AMP X 3ML");
    const catalogo = extractProductAttributes("DICLOFENACO 75MG/3ML (25MG/ML) SOLUCION INYECTABLE", {
      requirePresentation: false,
    });
    expect(bodega?.attributes.dosageForm).toBe("Inyectable");
    expect(catalogo?.attributes.dosageForm).toBe("Inyectable");
    expect(buildGenericKey(bodega!.attributes)).toBe(buildGenericKey(catalogo!.attributes));
  });

  it("reconoce 'gotas' como sinonimo coloquial de 'Solucion', no como forma aparte", () => {
    // Ningun producto real del catalogo tiene 'Gotas' como forma
    // farmaceutica: los proveedores siempre lo normalizan a 'Solucion' (p.
    // ej. 'SOL OFT GTS'). Antes 'gotas' mapeaba a una categoria separada que
    // ningun producto real usaba, asi que nunca coincidia con nada.
    const result = extractProductAttributes("Hidroxipropilmetilcelulosa 0.3% gotas oftalmicas", {
      requirePresentation: false,
    });
    expect(result?.attributes.dosageForm).toBe("Solución");
  });

  it("reconoce el tipo de empaque en plural, no solo en singular", () => {
    const result = extractProductAttributes("POLIETILENGLICOL 3350 17G POL ORL SOBRES X10");
    expect(result?.attributes.presentationType).toBe("Sobre");
  });

  it("reconoce 'CAP' como abreviatura de capsula (visto en datos reales de Disfarma)", () => {
    const result = extractProductAttributes("ACIDO VALPROICO 250MG FCO*50 CAP");
    expect(result?.attributes.dosageForm).toBe("Cápsula");
  });

  it("reconoce 'crema vaginal' como forma distinta de 'crema' a secas, sin importar como venga escrito", () => {
    // Bug real: "Estrogenos Conjugados crema" no aparecia en la busqueda porque
    // Disfarma reporta la forma como "CREM VAG" (columna aparte, sin reconocer
    // antes de este fix -> se guardaba tal cual) y Ramedicas la escribe dentro
    // del nombre ("...CREMA VAGINAL"), pero el escaneo palabra por palabra se
    // quedaba en "CREMA" y nunca llegaba a leer "VAGINAL". Una crema vaginal y
    // una crema topica no son intercambiables, asi que deben quedar como formas
    // farmaceuticas distintas (no colapsar ambas a "Crema").
    const disfarma = extractProductAttributes("ESTROGENOS CONJUGADOS 0.625MG/G CREM VAG TUBX43G+APLIC CX1");
    const ramedicas = extractProductAttributes("ESTROGENOS CONJUGADOS 0,625MG/G CREMA VAGINAL X43G");
    expect(disfarma?.attributes.dosageForm).toBe("Crema vaginal");
    expect(ramedicas?.attributes.dosageForm).toBe("Crema vaginal");
    expect(buildGenericKey(disfarma!.attributes)).toBe(buildGenericKey(ramedicas!.attributes));

    // Una crema topica normal sigue siendo "Crema", no se mezcla con la vaginal.
    const topica = extractProductAttributes("KETOCONAZOL 2G/100G CREMA TOPICA TUBX30G");
    expect(topica?.attributes.dosageForm).toBe("Crema");
    expect(buildGenericKey(topica!.attributes)).not.toBe(buildGenericKey(ramedicas!.attributes));
  });

  it("reconoce 'CREM' y 'GEL' como abreviaturas (visto en datos reales de Disfarma: CREM TOP, GEL TOP)", () => {
    expect(extractProductAttributes("SULFADIAZINA PLATA 1G/100G CREM TOP TUB*30G")?.attributes.dosageForm).toBe("Crema");
    expect(extractProductAttributes("KETOPROFENO 2.5G/100G GEL TOP TUB*60G")?.attributes.dosageForm).toBe("Gel");
  });

  it("distingue aerosol inhalador (oral) de aerosol nasal, sin colapsar ambos a 'Solucion'/'Suspension'", () => {
    // Bug real: "Beclometasona inhalador" no encontraba nada. Disfarma reporta
    // la forma como "AEROSOL INH BUC" (columna aparte, sin reconocer antes de
    // este fix) y variantes de solucion/suspension "para inhalacion" (Ramedicas)
    // o "SOL INH BUC"/"SUSP NAS" (Disfarma) colapsaban a la forma generica
    // "Solucion"/"Suspension", mezclando inhaladores orales con aerosoles
    // nasales y con soluciones sin relacion. Un inhalador oral (MDI) y un
    // aerosol nasal no son el mismo producto ni intercambiables.
    const disfarma = extractProductAttributes("BECLOMETASONA DIPROPIONATO 50MCG AEROSOL INH BUC FCOX200 DOSIS CX1");
    expect(disfarma?.attributes.dosageForm).toBe("Aerosol inhalador");

    const disfarmaNasal = extractProductAttributes("BECLOMETASONA DIPROPIONATO 50MCG/DOSIS AEROSOL INH NAS FCOX200 DOSIS CX1");
    expect(disfarmaNasal?.attributes.dosageForm).toBe("Aerosol nasal");

    const ramedicasSolucion = extractProductAttributes("BECLOMETASONA 50MCG SOLUCION PARA INHALACION X200");
    expect(ramedicasSolucion?.attributes.dosageForm).toBe("Solución inhalada");

    const ramedicasNasal = extractProductAttributes("BECLOMETASONA 50MCG SOLUCION PARA INHALACION NASAL X200");
    expect(ramedicasNasal?.attributes.dosageForm).toBe("Solución nasal");

    // No se mezclan entre si.
    expect(buildGenericKey(disfarma!.attributes)).not.toBe(buildGenericKey(disfarmaNasal!.attributes));
    expect(buildGenericKey(ramedicasSolucion!.attributes)).not.toBe(buildGenericKey(ramedicasNasal!.attributes));
  });

  it("reconoce 'inhalador' como termino de busqueda de cliente", () => {
    const guess = extractIngredientGuess("Beclometasona inhalador");
    expect(guess).toBe("BECLOMETASONA");
    expect(normalizeDosageForm("inhalador")).toBe("Aerosol inhalador");
  });

  it("tolera una cantidad de presentacion al final ('X 360 ML') sin descartar la busqueda por tener un digito", () => {
    // Bug real: "Hidroxido de aluminio + Simeticona suspension x 360 ml" no
    // daba ninguna opcion, porque extractIngredientGuess descartaba CUALQUIER
    // texto con un digito -- incluyendo un tamaño de envase reconocido, que
    // no es una concentracion mal escrita.
    expect(extractIngredientGuess("Hidróxido de aluminio + simeticona suspensión x 360 ml")).toBe(
      "HIDROXIDO DE ALUMINIO + SIMETICONA",
    );
  });

  it("sigue descartando la busqueda si el digito no es parte de una cantidad de presentacion reconocida", () => {
    expect(extractIngredientGuess("Amoxicilina 500 suspension")).toBeNull();
  });

  it("corta el ingrediente en una palabra de empaque aunque no sea una forma farmaceutica ('sobres')", () => {
    // Bug real: el cliente busco "Polietilenglicol sobres" y no encontro
    // nada, porque "sobres" no es una forma farmaceutica reconocida (es
    // empaque, no dosis) y se quedaba pegada al ingrediente extraido
    // ("POLIETILENGLICOL SOBRES"), sin coincidir con la clave real del
    // catalogo ("polietilenglicol" a secas).
    expect(extractIngredientGuess("Polietilenglicol sobres")).toBe("POLIETILENGLICOL");
  });
});

describe("normalizeDosageForm", () => {
  it("normaliza una forma compuesta reportada por columna al vocabulario controlado", () => {
    // "Solución inyectable" es una ampolla/vial sellado de un solo uso, no un
    // líquido a granel del que se sirven dosis parciales como un jarabe: se
    // clasifica como "Inyectable", no "Solución" a secas (bug real -- ver
    // COMPOUND_DOSAGE_FORM_MAP).
    expect(normalizeDosageForm("SOLUCION INYECTABLE")).toBe("Inyectable");
    expect(normalizeDosageForm("TABLETA RECUBIERTA")).toBe("Tableta");
  });

  it("devuelve null cuando no reconoce ninguna palabra clave", () => {
    expect(normalizeDosageForm("DISPOSITIVO INTRAUTERINO")).toBeNull();
  });

  it("produce el mismo valor que la extraccion por texto libre (evita romper genericKey)", () => {
    // Un importador que reciba "SOLUCION INYECTABLE" en una columna aparte debe
    // normalizarla igual que si viniera escrita dentro del nombre del producto,
    // o dos filas del mismo generico terminan con genericKey distinto.
    const fromText = extractProductAttributes("DICLOFENACO 75MG SOLUCION INYECTABLE X10");
    expect(normalizeDosageForm("SOLUCION INYECTABLE")).toBe(fromText?.attributes.dosageForm);
  });

  it("prioriza la frase completa sobre la primera palabra suelta (crema vaginal vs crema)", () => {
    // Dato real de la columna FORMA_FARMACEUTICA de Disfarma.
    expect(normalizeDosageForm("CREM VAG")).toBe("Crema vaginal");
    expect(normalizeDosageForm("CREMA VAGINAL")).toBe("Crema vaginal");
    expect(normalizeDosageForm("CREMA")).toBe("Crema");
  });
});

describe("buildGenericKey", () => {
  it("produce la misma clave generica para variantes de escritura equivalentes", () => {
    const a = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    const b = extractProductAttributes("Acetaminofen tableta 500 mg x 100");
    expect(buildGenericKey(a!.attributes)).toBe(buildGenericKey(b!.attributes));
  });

  it("ignora el orden de las palabras del ingrediente activo (Ramedicas vs Disfarma)", () => {
    // Caso real: Ramedicas escribe "VALPROICO ACIDO" (alfabetizado) y Disfarma
    // "ACIDO VALPROICO" (orden natural) para la misma sustancia — sin esto,
    // nunca se comparaban entre proveedores ni se encontraban por busqueda.
    const disfarma = extractProductAttributes("ACIDO VALPROICO 250MG JARABE X120ML");
    const ramedicas = extractProductAttributes("VALPROICO ACIDO 250MG JARABE X120ML");
    expect(buildGenericKey(disfarma!.attributes)).toBe(buildGenericKey(ramedicas!.attributes));
  });

  it("ignora la preposicion 'de'/'del' al comparar principios activos", () => {
    // Bug real: el cliente busco "Pamoato de pirantel suspension" y no
    // encontro nada, porque el catalogo tiene el producto como "PAMOATO
    // PIRANTEL" (sin "de"). El patron quimico en espanol "[Radical] de
    // [Base]" (Cloruro de Sodio, Bromuro de Tiotropio, etc.) se escribe de
    // forma inconsistente entre proveedores y clientes.
    const conDe = extractProductAttributes("PAMOATO DE PIRANTEL 250MG SUSPENSION X15");
    const sinDe = extractProductAttributes("PAMOATO PIRANTEL 250MG SUSPENSION X15");
    expect(buildGenericKey(conDe!.attributes)).toBe(buildGenericKey(sinDe!.attributes));
  });

  it("ignora un '+' suelto entre principios activos separados por espacio", () => {
    // Bug real: "ALUMINIO HIDROXIDO + MAGNESIO + SIMETICONA" (con espacios
    // alrededor del "+") dejaba el "+" como si fuera una palabra mas del
    // ingrediente al ordenar alfabeticamente ("+ + aluminio hidroxido...").
    // Afectaba decenas de combinados reales de ambos proveedores. (Nota: un
    // "+" pegado sin espacios, como "HIDROXIDO+MAGNESIO", sigue siendo un
    // problema aparte — ahí el token fusionado no calza con la forma
    // separada por espacios; no es lo que corrige este fix.)
    const conEspacios = extractProductAttributes("ALUMINIO HIDROXIDO + MAGNESIO + SIMETICONA 4G X150ML");
    expect(buildGenericKey(conEspacios!.attributes)).toBe("aluminio hidroxido magnesio simeticona 4 g no especificada");
    expect(buildGenericKey(conEspacios!.attributes)).not.toMatch(/[+(]/);
  });

  it("no deja un parentesis colgando cuando la concentracion combinada viene entre parentesis", () => {
    // Bug real: "...SIMETICONA (4G+4G+0.4G)/100ML..." corta el nombre del
    // producto justo antes del primer numero dentro del parentesis, dejando
    // el "(" pegado al final del ingrediente extraido ("...SIMETICONA (").
    // Ese "(" terminaba ordenado como si fuera parte del ingrediente.
    const result = extractProductAttributes("ALUMINIO HIDROXIDO + MAGNESIO + SIMETICONA (4G+4G+0.4G)/100ML X150ML");
    expect(result?.attributes.activeIngredient).not.toMatch(/[(+]$/);
    expect(buildGenericKey(result!.attributes)).not.toMatch(/[+(]/);
  });

  it("reconoce el mismo combinado aunque el proveedor invierta el orden de los principios Y sus dosis", () => {
    // Caso real reportado por el cliente (2026-09-24): Disfarma escribe
    // "HIDROCORTISONA+LIDOCAINA 5MG+60MG" (sin espacios alrededor del "+")
    // y Ramédicas "LIDOCAINA + HIDROCORTISONA 60MG+5MG" (con espacios) --
    // es el MISMO medicamento (hidrocortisona 5mg + lidocaina 60mg), pero
    // antes no se reconocían como tal: alfabetizar solo el nombre no basta
    // si la dosis de cada principio también quedó en el orden contrario.
    const disfarma = extractProductAttributes("HIDROCORTISONA+LIDOCAINA 5MG+60MG C*10 SUPOS");
    // Ramédicas trae la presentación en su propia columna ("CAJA X 10"), que
    // el importador concatena al nombre antes de extraer (ver readMappedRow
    // en lib/excel/importer.ts) -- se simula igual aquí.
    const ramedicas = extractProductAttributes("LIDOCAINA + HIDROCORTISONA 60MG+5MG SUPOSITORIO RECTAL CAJA X 10");
    expect(disfarma).not.toBeNull();
    expect(ramedicas).not.toBeNull();
    expect(buildGenericKey(disfarma!.attributes)).toBe(buildGenericKey(ramedicas!.attributes));
    // La dosis de cada principio se conserva correctamente emparejada, no
    // solo el nombre: hidrocortisona (alfabéticamente primero) con 5, no 60.
    expect(disfarma!.attributes.concentration).toBe("5/60");
    expect(ramedicas!.attributes.concentration).toBe("5/60");
  });

  it("no reordena la dosis si la cantidad de principios y de dosis no coincide (más conservador que adivinar)", () => {
    const result = extractProductAttributes("ALUMINIO HIDROXIDO+MAGNESIO+SIMETICONA 4G+4G X150ML");
    expect(result).not.toBeNull();
    // 3 principios pero solo 2 dosis -- no hay forma segura de emparejar; se
    // deja el comportamiento anterior (solo la primera dosis encontrada).
    expect(result!.attributes.concentration).toBe("4");
  });
});

describe("buildNormalizedName", () => {
  it("distingue el mismo generico ofrecido por laboratorios distintos", () => {
    const attrs = extractProductAttributes("ACETAMINOFEN TAB 500MG X100")!.attributes;
    const genfar = buildNormalizedName(attrs, "genfar");
    const pfizer = buildNormalizedName(attrs, "pfizer");
    expect(genfar).not.toBe(pfizer);
    expect(buildGenericKey(attrs)).toBe(buildGenericKey(attrs)); // misma clave generica
  });

  it("usa un sufijo estable cuando no se conoce el laboratorio", () => {
    const attrs = extractProductAttributes("ACETAMINOFEN TAB 500MG X100")!.attributes;
    expect(buildNormalizedName(attrs, null)).toBe(buildNormalizedName(attrs, null));
    expect(buildNormalizedName(attrs, null)).not.toBe(buildNormalizedName(attrs, "genfar"));
  });
});
