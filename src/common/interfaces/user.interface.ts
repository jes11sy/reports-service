/**
 * Интерфейс пользователя из JWT токена
 */
export interface JwtUserPayload {
  sub: number;           // userId
  userId: number;
  login: string;
  role: UserRoleType;
  cityIds?: number[];    // Для директоров/операторов
  iat?: number;
  exp?: number;
}

/**
 * Типы ролей пользователей
 */
export type UserRoleType = 'master' | 'director' | 'admin' | 'operator';

/**
 * Интерфейс для req.user в контроллерах
 */
export interface RequestUser {
  userId: number;
  login: string;
  role: UserRoleType;
  cityIds?: number[];
}
