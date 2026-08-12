const REGISTRATION_PATTERN = /^[A-Z0-9]{2,8}$/;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = 400;
  }
}

export function normalizeRegistration(value) {
  if (typeof value !== "string") {
    throw new ValidationError("Enter a UK registration number.");
  }

  const registration = value.toUpperCase().replace(/[\s-]/g, "");

  if (
    !REGISTRATION_PATTERN.test(registration) ||
    !/[A-Z]/.test(registration) ||
    !/[0-9]/.test(registration)
  ) {
    throw new ValidationError("Enter a valid UK registration number.");
  }

  return registration;
}

function normalizeDefect(issue, fallbackType) {
  const text =
    issue?.text ||
    issue?.comment ||
    issue?.reason ||
    issue?.description ||
    "Issue found";

  const type = (
    issue?.type ||
    issue?.severity ||
    issue?.category ||
    fallbackType ||
    "ADVISORY"
  ).toUpperCase();

  return { text: String(text), type: String(type) };
}

export function normalizeMotHistory(motRaw) {
  const vehicle = Array.isArray(motRaw) ? motRaw[0] : motRaw;
  const tests = Array.isArray(vehicle?.motTests) ? vehicle.motTests : [];

  return tests.map((test) => {
    const defects = [];

    if (Array.isArray(test.rfrAndComments)) {
      defects.push(
        ...test.rfrAndComments.map((issue) =>
          normalizeDefect(issue, "ADVISORY")
        )
      );
    }

    const fallbackCollections = {
      advisories: "ADVISORY",
      minorDefects: "MINOR",
      majorDefects: "MAJOR",
      dangerousDefects: "DANGEROUS",
      defects: "ADVISORY",
      reasons: "ADVISORY",
    };

    for (const [key, fallbackType] of Object.entries(fallbackCollections)) {
      if (Array.isArray(test[key])) {
        defects.push(
          ...test[key].map((issue) => normalizeDefect(issue, fallbackType))
        );
      }
    }

    const uniqueDefects = [
      ...new Map(
        defects.map((defect) => [
          `${defect.type}:${defect.text.toLowerCase()}`,
          defect,
        ])
      ).values(),
    ];

    return {
      completedDate: test.completedDate || null,
      result: test.testResult || "UNKNOWN",
      mileage: test.odometerValue || null,
      mileageUnit: test.odometerUnit || "mi",
      defects: uniqueDefects,
    };
  });
}

export function buildVehicleResponse(registration, dvla, motRaw) {
  const motVehicle = Array.isArray(motRaw) ? motRaw[0] : motRaw;

  return {
    registration,
    make: dvla.make || motVehicle?.make || "Unknown",
    model: dvla.model || motVehicle?.model || "Unknown",
    colour: dvla.colour || "Unknown",
    fuelType: dvla.fuelType || "Unknown",
    engineCapacity: dvla.engineCapacity ?? null,
    year: dvla.yearOfManufacture ?? null,
    monthOfFirstRegistration: dvla.monthOfFirstRegistration || null,
    taxStatus: dvla.taxStatus || "Unknown",
    taxDueDate: dvla.taxDueDate || null,
    motStatus: dvla.motStatus || "Unknown",
    motExpiryDate: dvla.motExpiryDate || null,
    co2Emissions: dvla.co2Emissions ?? null,
    euroStatus: dvla.euroStatus || "Unknown",
    realDrivingEmissions: dvla.realDrivingEmissions || "Unknown",
    typeApproval: dvla.typeApproval || "Unknown",
    wheelplan: dvla.wheelplan || "Unknown",
    revenueWeight: dvla.revenueWeight ?? null,
    exportMarker: Boolean(dvla.exportMarker),
    dateOfLastV5CIssued: dvla.dateOfLastV5CIssued || null,
    motHistory: normalizeMotHistory(motRaw),
  };
}
