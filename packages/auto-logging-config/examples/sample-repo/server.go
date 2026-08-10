package main

import (
	"fmt"
	"log"
)

func handleRequest(user string, code int) {
	log.Printf("user %s logged in with code %d", user, code)
}

func connectDB(host string, port int) {
	log.Printf("connecting to database at %s:%d", host, port)
	fmt.Printf("startup complete in %.2f seconds", 1.25)
}
