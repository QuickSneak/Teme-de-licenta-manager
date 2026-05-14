import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { faculties, specializations } from './db/schema';

export type UserRole = 'student' | 'professor' | 'secretary';

export type SpecialtyConfig = {
  code: string;
  faculty: string;
  specialty: string;
  durationYears: number;
};

export const specialtyMappings: Record<string, SpecialtyConfig> = {
  info: {
    code: 'info',
    faculty: 'Informatica si Inginerie',
    specialty: 'Informatica',
    durationYears: 3
  },
  infoen: {
    code: 'infoen',
    faculty: 'Informatica si Inginerie',
    specialty: 'Informatica EN',
    durationYears: 3
  },
  mk: {
    code: 'mk',
    faculty: 'Stiinte Economice',
    specialty: 'Marketing',
    durationYears: 3
  }
};

export const dashboardByRole: Record<UserRole, string> = {
  student: '/dashboard.html',
  professor: '/professor-dashboard.html',
  secretary: '/secretary-dashboard.html'
};

export function isUserRole(value: string): value is UserRole {
  return value === 'student' || value === 'professor' || value === 'secretary';
}

export function parseStudentEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.endsWith('@uab.ro')) return null;

  const localPart = normalizedEmail.slice(0, -'@uab.ro'.length);
  const parts = localPart.split('.');
  if (parts.length !== 3 || !parts.every(Boolean)) return null;

  const [lastName, firstName, specialtyAndYear] = parts;
  if (!/^[a-z]+$/.test(lastName) || !/^[a-z]+$/.test(firstName)) return null;

  const yearMatch = specialtyAndYear.match(/^([a-z]+)(\d{2})$/);
  if (!yearMatch) return null;

  const [, specialtyCode, shortYear] = yearMatch;
  const mapping = specialtyMappings[specialtyCode];
  if (!mapping) return null;

  return {
    email: normalizedEmail,
    lastName,
    firstName,
    specialtyCode,
    startYear: 2000 + Number(shortYear),
    mapping
  };
}

export function validateStudentEmail(email: string) {
  const parsed = parseStudentEmail(email);
  if (!parsed) {
    return { ok: false as const, error: 'Use a valid UAB student email.' };
  }

  const finalYear = parsed.startYear + parsed.mapping.durationYears - 1;
  if (new Date().getFullYear() < finalYear) {
    return { ok: false as const, error: 'Only final-year students can register.' };
  }

  return { ok: true as const, parsed };
}

export function validateProfessorEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.endsWith('@uab.ro')) {
    return { ok: false as const, error: 'Professors must use a @uab.ro email.' };
  }

  if (parseStudentEmail(normalizedEmail)) {
    return { ok: false as const, error: 'Student emails cannot be used for professor accounts.' };
  }

  const localPart = normalizedEmail.slice(0, -'@uab.ro'.length);
  if (!/^[a-z]+(\.[a-z]+)*$/.test(localPart)) {
    return { ok: false as const, error: 'Use a valid professor email.' };
  }

  return { ok: true as const, email: normalizedEmail };
}

export async function ensureAcademicUnit(mapping: SpecialtyConfig) {
  let faculty = await db
    .select()
    .from(faculties)
    .where(eq(faculties.name, mapping.faculty))
    .get();

  if (!faculty) {
    faculty = await db.insert(faculties).values({ name: mapping.faculty }).returning().get();
  }

  let specialization = await db
    .select()
    .from(specializations)
    .where(and(eq(specializations.name, mapping.specialty), eq(specializations.facultyId, faculty.id)))
    .get();

  if (!specialization) {
    specialization = await db
      .insert(specializations)
      .values({ name: mapping.specialty, facultyId: faculty.id })
      .returning()
      .get();
  }

  return { faculty, specialization };
}
