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
