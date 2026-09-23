export class ApiError extends Error {
 constructor(message:string,public code='REQUEST_FAILED',public status=0){super(message);this.name='ApiError'}
}
export function errorMessage(error:unknown):string{return error instanceof Error?error.message:'Не удалось выполнить действие. Попробуйте ещё раз.'}
