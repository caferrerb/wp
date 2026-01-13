en especificacion.md esta la explicacion de un proyecto que quiero hacer para conexion a whatsapp.

ademas de todo lo que hay alli, necesito

1. una aplicacion que reciba los mensaje estos JAMAS deben quedar como leidos.

2. una base de datos donde quede guardados los mesnajes

3. una interface web sencilla donde vea que mensajes llegaron, solo lectura, no debe marcar los mensajes como leidos.

4. la app web y el backend deben estar en la misma aplicacion 

5. esto lo voy a desplegar en AWS en un EC2 para que lo tenga en cuenta, cree un script qu arranque el proceso y que sea recilente, que se instale como proceso del S.O

6. debe tener un endpoint que si lo llamo me mande un correo electronico un csv de los mensajes recibidos y ese proceso se debe llamar al finalizar el dia.

7. configure esta API https://github.com/mailersend/mailersend-nodejs?tab=readme-ov-file#send-an-email para que atraves de ella se envie el mail. pero debe haber una interface que defina el sendMail que tenga el destinatario, el remitente, el cupero del mensaje y un adjunto y debe haber una implementacion de mailersend.

8. configure bien las variables de entorno y configure el .env.example

el proyecto debe ser en nodejs con typescript, debe ser sencillo pero funcional, una buena y clara arquiectura pero tampoco nada sobrepensado, que sea facil de entender y mantener.

esta es una tarea totalmente no supervisada, ejecutela de principio a fin

cree un doucmento donde planifique la implementacion que ud va a hacer, itere esa documentacion 2 veces hasta que toedos los requisitos esten definidos.


luegoq de esto lo debe implementar, no debe pedir permiso, hacerlo de inicio a fin.

cree el docker file con la aplicacion 
y un docker compose con la BD.

RECUERDE, NO SUPERVISADA, IMPLEMENTE DE INICIO A FIN.

ultrathink.