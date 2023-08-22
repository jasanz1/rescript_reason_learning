#1 "server/server.eml.re"
let home ={ 
let ___eml_buffer = Buffer.create(4096);
Buffer.add_string(___eml_buffer, "<html>\n  <body>\n    <p>\n      ");
Printf.bprintf(___eml_buffer, "%s")(Dream_pure.Formats.html_escape (
#5 "server/server.eml.re"
            Common.greet(`Server) 
));
Buffer.add_string(___eml_buffer, " \n    </p>\n    <script src=\"/static/client.js\"></script>\n  </body>\n</html>\n");
Buffer.contents(___eml_buffer)
#10 "server/server.eml.re"
};

let () =
  Dream.run
  @@ Dream.logger  @@ Dream.router ([
    Dream.get ("/" , _ => Dream.html(home)),
    Dream.get ("/static/**", Dream.static ("./static")),

  ]);
